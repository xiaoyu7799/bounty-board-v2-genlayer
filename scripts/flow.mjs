// Evidence run for Bounty Board v2 on the deployed contract.
// Usage: node scripts/flow.mjs [evidence/prs.json]
//   prs.json maps bounty ids to { pr, note_path, note_text, expected }.
//
// Checkpoint / resume: after every FINALIZED tx the
// flow writes <workdir>/checkpoint.json (0600, outside repo/, never
// committed) with the contract address, every tx hash, per-case progress
// and the temporary account private keys, so a killed run resumes from
// the first unfinished step instead of redeploying. On startup the flow
// loads the checkpoint and verifies it against the chain (LATEST_FINAL
// readback + every recorded tx receipt); a checkpoint whose contract is
// abandoned or mismatched is discarded and the run starts fresh. The
// checkpoint is deleted as soon as the flow finishes (DONE + evidence
// written). This flow uses no salts. Progress-only journaling still goes
// to evidence/flow.json (hashes and read-backs only — no keys).
//
// Retry rules (from the v1 lessons):
// - Reads and receipt waits retry on transient RPC failures.
// - evaluate / resolve retry only AFTER the previous attempt reached a
//   FINALIZED receipt showing an error or no majority. A write whose
//   receipt never arrived is UNCERTAIN and is never resubmitted.
// - Mirror pre-flight runs before every evaluate: the delivery note is
//   fetched from both mirrors at the merge commit and must agree.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createAccount, generatePrivateKey } from 'genlayer-js';
import {
  RPC, GEN, WEI_PER_UNIT, validateChain, sendLocal, encoded,
  readJson, fundAndWait, contractBalance, waitFinalized, receiptSummary, rpc,
} from './network.mjs';
import {
  CHECKPOINT_PATH, readCheckpoint, writeCheckpoint, deleteCheckpoint,
  verifyCheckpoint,
} from './checkpoint.mjs';

const deployment = JSON.parse(fs.readFileSync('evidence/deployment.json', 'utf8'));
if (deployment.contractSha256 !== (await import('node:crypto')).createHash('sha256').update(fs.readFileSync('contracts/bounty_board.py')).digest('hex')) {
  throw Error('SOURCE_DIFFERS_FROM_DEPLOYMENT: historical flow cannot validate the revised contract');
}
const CONTRACT = deployment.contractAddress;
assert(CONTRACT, 'No contract address in evidence/deployment.json');
const prsFile = process.argv[2] || 'evidence/prs.json';
const PRS = JSON.parse(fs.readFileSync(prsFile, 'utf8'));
const SLUG = 'xiaoyu7799/bounty-board-v2-genlayer';
const GH = 'https://api.github.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await validateChain();

// -- checkpoint / resume -----------------------------------------------------
// Load a checkpoint from a previous (killed) run, if one exists, and verify
// it against live chain state before trusting it. A checkpoint whose
// contract differs from this deployment, or which fails any on-chain
// check, is discarded and the run starts fresh. A verified checkpoint
// restores the temp accounts (from their keys) and the journal, and the
// case blocks below skip every step already recorded.
let resumed = null;
{
  let cp = null;
  try {
    cp = readCheckpoint();
  } catch (e) {
    // Corrupt or wrong-version checkpoint: never trust it, discard it.
    console.log(JSON.stringify({ checkpoint: 'discarded', reason: `UNREADABLE:${String(e.message || e).slice(0, 80)}` }));
    deleteCheckpoint();
  }
  if (cp) {
    if (cp.contract !== CONTRACT) {
      console.log(JSON.stringify({ checkpoint: 'discarded', reason: 'CONTRACT_MISMATCH', checkpoint_contract: cp.contract, deployment_contract: CONTRACT }));
      deleteCheckpoint();
    } else {
      const v = await verifyCheckpoint(cp, { expectedContract: CONTRACT, readJson, rpc });
      if (!v.ok) {
        console.log(JSON.stringify({ checkpoint: 'discarded', reason: v.reason }));
        deleteCheckpoint();
      } else {
        resumed = cp;
        console.log(JSON.stringify({ checkpoint: 'resumed', contract: cp.contract, cases: Object.keys(cp.cases || {}), transactions: (cp.transactions || []).length }));
      }
    }
  }
}

// Keys are generated first and kept in variables: createAccount() does not
// expose a private key, so the key must exist before the account does in
// order to be checkpointed. On resume the keys come from the checkpoint.
let issuerKey; let hunterKey; let strangerKey;
let issuer; let hunter; let stranger;
if (resumed) {
  issuerKey = resumed.accounts.issuer.privateKey;
  hunterKey = resumed.accounts.hunter.privateKey;
  strangerKey = resumed.accounts.stranger.privateKey;
} else {
  issuerKey = generatePrivateKey();
  hunterKey = generatePrivateKey();
  strangerKey = generatePrivateKey();
}
issuer = createAccount(issuerKey);
hunter = createAccount(hunterKey);
stranger = createAccount(strangerKey);
console.log(JSON.stringify({ contract: CONTRACT, issuer: issuer.address, hunter: hunter.address, stranger: stranger.address, resumed: Boolean(resumed) }));

// -- journal + checkpoint ----------------------------------------------------
// save() persists BOTH the public journal (evidence/flow.json, no keys)
// and the checkpoint (workdir checkpoint.json, 0600, keys included).
// Every call site that records a FINALIZED tx or a case-state change goes
// through save(), so a kill can only lose work after the last save.
const journalFile = 'evidence/flow.json';
const journal = resumed ? {
  network: 'Stable Studionet', chain_id: 61999, contract: CONTRACT,
  money: 'Real testnet GEN. Bounty amounts in units (1 unit = 0.001 GEN).',
  started_at: resumed.started_at,
  resumed_at: new Date().toISOString(),
  issuer: issuer.address, hunter: hunter.address, stranger: stranger.address,
  cases: resumed.cases || {}, transactions: resumed.transactions || [],
} : {
  network: 'Stable Studionet', chain_id: 61999, contract: CONTRACT,
  money: 'Real testnet GEN. Bounty amounts in units (1 unit = 0.001 GEN).',
  started_at: new Date().toISOString(),
  issuer: issuer.address, hunter: hunter.address, stranger: stranger.address,
  cases: {}, transactions: [],
};
function saveCheckpoint() {
  writeCheckpoint({
    contract: CONTRACT,
    deploy_tx: deployment.deployTxHash,
    contract_source_sha256: deployment.contractSha256,
    accounts: {
      issuer: { address: issuer.address, privateKey: issuerKey },
      hunter: { address: hunter.address, privateKey: hunterKey },
      stranger: { address: stranger.address, privateKey: strangerKey },
    },
    cases: journal.cases,
    transactions: journal.transactions,
    started_at: journal.started_at,
  });
}
const save = () => {
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2) + '\n');
  saveCheckpoint();
};
save();

// Record one completed step (tx hash) on a case and persist immediately,
// so the checkpoint always reflects the last FINALIZED tx.
function setStep(c, name, hash) {
  c.steps[name] = hash;
  save();
}

// Top up only when needed: on resume the accounts may already hold enough
// testnet GEN, and sim_fundAccount credits are additive, so blindly
// re-funding would inflate balances. 49 GEN is the fundAndWait floor
// (50 GEN minus the 1% faucet-precision slack).
async function fundIfNeeded(account, label) {
  const bal = BigInt(await rpc('eth_getBalance', [account.address, 'latest']));
  if (bal >= 49n * GEN) {
    console.log(JSON.stringify({ funding: 'skipped', account: label, balance_gen: (bal / GEN).toString() }));
    return bal;
  }
  const funded = await fundAndWait(account, 50n * GEN);
  console.log(JSON.stringify({ funding: 'topped-up', account: label, balance_gen: (funded / GEN).toString() }));
  return funded;
}
for (const [account, label] of [[issuer, 'issuer'], [hunter, 'hunter'], [stranger, 'stranger']]) {
  await fundIfNeeded(account, label);
}
console.log('funded issuer/hunter/stranger with 50 GEN each (testnet GEN)');
save();

// -- chain helpers -----------------------------------------------------------
async function call(account, method, args, value = 0n) {
  const hash = await sendLocal(account, CONTRACT, encoded(method, args), value);
  const receipt = await waitFinalized(hash, { timeoutMs: 15 * 60 * 1000 });
  if (!receipt) throw Error(`UNCERTAIN_NO_FINALIZED_RECEIPT:${method}:${hash}`);
  const summary = receiptSummary(receipt);
  journal.transactions.push({ method, hash, ...summary });
  save();
  return { hash, receipt, summary };
}

function okReceipt({ receipt, summary }, method) {
  assert.equal(receipt.status, 'FINALIZED', `${method} not FINALIZED`);
  assert.equal(receipt.result_name, 'MAJORITY_AGREE', `${method} no majority: ${summary.result_name}`);
  assert.equal(summary.leader_execution, 'SUCCESS', `${method} leader not SUCCESS: ${summary.leader_execution}`);
}

async function getBounty(id) {
  return readJson(CONTRACT, 'get_bounty', [id]);
}
async function getTotals() {
  return readJson(CONTRACT, 'get_ledger_totals', []);
}
async function getWithdrawable(address) {
  return readJson(CONTRACT, 'get_withdrawable', [address]);
}

async function checkConservation(step) {
  const totals = await getTotals();
  const received = BigInt(totals.total_received_wei);
  const withdrawn = BigInt(totals.total_withdrawn_wei);
  const withdrawable = BigInt(totals.withdrawable_wei);
  const escrowed = BigInt(totals.escrowed_wei);
  const recomputed = BigInt(totals.escrowed_wei_recomputed);
  assert.equal(received, withdrawn + withdrawable + escrowed, `conservation broken at ${step}`);
  assert.equal(escrowed, recomputed, `escrow recompute mismatch at ${step}`);
  const balance = BigInt(await contractBalance(CONTRACT));
  assert.equal(balance, received - withdrawn, `contract balance mismatch at ${step}`);
  return totals;
}

async function withdrawIfOwed(account, label) {
  const w = await getWithdrawable(account.address);
  if (BigInt(w.withdrawable_wei) > 0n) {
    const { hash, receipt, summary } = await call(account, 'withdraw', []);
    okReceipt({ receipt, summary }, `${label} withdraw`);
    return hash;
  }
  return null;
}

// -- GitHub pre-flight ---------------------------------------------------------
// Raw fetch can REJECT (network error, undici headers timeout) — the retry
// loops below only handled non-ok statuses, so one hung CDN/GitHub fetch
// killed run 5 as an uncaught exception mid-case. Every fetch now retries
// on throw too, with a 30s per-attempt timeout.
async function fetchRetry(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // 'connection: close' — run 8 died because undici's keep-alive pool
      // held a socket the server had closed during the 10-minute pause;
      // every reuse hung to the 30s timeout. Fresh connection per request.
      return await fetch(url, {
        headers: { 'user-agent': 'bounty-board-v2-evidence', connection: 'close' },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      await sleep(5000 * (attempt + 1));
    }
  }
  throw Error(`FETCH_FAILED:${url}`);
}
async function ghJson(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchRetry(url);
    if (res.status === 404) return null;
    if (!res.ok) { await sleep(5000 * (attempt + 1)); continue; }
    return res.json();
  }
  throw Error(`GITHUB_API_FAILED:${url}`);
}
async function ghText(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchRetry(url);
    if (res.status === 404) return null;
    if (!res.ok) { await sleep(5000 * (attempt + 1)); continue; }
    return res.text();
  }
  throw Error(`GITHUB_FETCH_FAILED:${url}`);
}

async function preflightPr(bountyId, cfg) {
  const pr = await ghJson(`${GH}/repos/${cfg.slug || SLUG}/pulls/${cfg.pr}`);
  assert(pr, `PR ${cfg.pr} not found`);
  assert.equal(pr.merged, true, `PR ${cfg.pr} not merged`);
  assert.equal(String(pr.user.login).toLowerCase(), 'xiaoyu7799', `PR ${cfg.pr} author mismatch`);
  assert(/^[0-9a-f]{40}$/.test(pr.merge_commit_sha), `PR ${cfg.pr} bad merge sha`);
  const commits = await ghJson(`${GH}/repos/${cfg.slug || SLUG}/pulls/${cfg.pr}/commits?per_page=100`);
  assert(commits.some((c) => String(c.commit.message).includes(bountyId)), `no commit mentions ${bountyId}`);
  const files = await ghJson(`${GH}/repos/${cfg.slug || SLUG}/pulls/${cfg.pr}/files?per_page=100`);
  const codeExts = ['.py', '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '.html', '.css', '.json', '.rs', '.go', '.sol', '.java', '.c', '.cpp', '.h'];
  const codeFiles = files.filter((f) => codeExts.some((ext) => f.filename.toLowerCase().endsWith(ext)));
  const lines = codeFiles.reduce((n, f) => n + f.additions + f.deletions, 0);
  console.log(JSON.stringify({ preflight: bountyId, pr: cfg.pr, merged: true, merge_sha: pr.merge_commit_sha, code_files: codeFiles.length, lines }));
  if (cfg.expect_gate_pass) {
    assert(codeFiles.length >= 2 && lines >= 100, `PR ${cfg.pr} below code minimum`);
  }
  return { pr, mergeSha: pr.merge_commit_sha, codeFiles: codeFiles.length, lines };
}

async function mirrorPreflight(bountyId, cfg, mergeSha) {
  if (!cfg.note_path) return null;
  const slug = cfg.slug || SLUG;
  for (let attempt = 0; attempt < 10; attempt++) {
    // Each mirror is fetched independently: a throw on one host must not
    // skip the other (run 8: raw flapped while jsdelivr was fine, but the
    // shared try/catch never tried the backup). A throw counts as missing.
    let primary = null;
    let backup = null;
    try {
      primary = await ghText(`https://raw.githubusercontent.com/${slug}/${mergeSha}/${cfg.note_path}`);
    } catch (e) {
      console.log(JSON.stringify({ mirror: bountyId, agree: false, attempt, host: 'raw', fetch_error: String(e.message || e).slice(0, 80) }));
    }
    try {
      backup = await ghText(`https://cdn.jsdelivr.net/gh/${slug}@${mergeSha}/${cfg.note_path}`);
    } catch (e) {
      console.log(JSON.stringify({ mirror: bountyId, agree: false, attempt, host: 'jsdelivr', fetch_error: String(e.message || e).slice(0, 80) }));
    }
    if (primary !== null && backup !== null && primary === backup) {
      console.log(JSON.stringify({ mirror: bountyId, agree: true, bytes: primary.length }));
      return true;
    }
    if (primary === null && backup === null) {
      console.log(JSON.stringify({ mirror: bountyId, agree: 'note-absent', attempt }));
      return false;
    }
    console.log(JSON.stringify({ mirror: bountyId, agree: false, attempt, wait_s: 60 }));
    await sleep(60000);
  }
  throw Error(`MIRROR_PREFLIGHT_FAILED:${bountyId}`);
}

// Evaluate with retries only after a FINALIZED error/no-majority receipt.
// Evaluate with retries. GenVM validators call the GitHub API without
// authentication (60 requests/hour per egress IP, shared across the
// whole Studionet pool), so a busy hour can fail several attempts in a
// row with GITHUB_API_HTTP_ERROR. Each attempt burns ~20 API calls from
// the shared pool, so retries use growing gaps: the rolling window frees
// roughly one call per minute, and a 600s gap restores about ten calls.
// Ten attempts with gaps 120s..600s span roughly an hour. A wrong
// verdict still throws immediately; only consensus failure retries.
async function evaluateWithRetry(bountyId, method, expectedVerdict, label) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const { hash, receipt, summary } = await call(issuer, method, [bountyId]);
    if (receipt.status === 'FINALIZED' && receipt.result_name === 'MAJORITY_AGREE' &&
        summary.leader_execution === 'SUCCESS') {
      const bounty = await getBounty(bountyId);
      const verdict = bounty.pending_verdict?.verdict;
      console.log(JSON.stringify({ evaluate: label, attempt, hash, verdict }));
      if (verdict !== expectedVerdict) {
        throw Error(`UNEXPECTED_VERDICT:${label}:expected ${expectedVerdict}, got ${verdict}: ${hash}`);
      }
      return { hash, bounty };
    }
    const gapS = Math.min(120 * attempt, 600);
    console.log(JSON.stringify({ evaluate: label, attempt, hash, ...summary, retry_in_s: gapS }));
    await sleep(gapS * 1000);
  }
  throw Error(`EVALUATE_RETRY_EXHAUSTED:${label}`);
}

async function runCase(bountyId, cfg) {
  // Reuse the restored case on resume (never wipe recorded steps); a fresh
  // run starts with an empty steps map. Each step is skipped when its hash
  // is already recorded — the startup checkpoint verification has already
  // confirmed every recorded tx is FINALIZED and the on-chain state
  // matches, so skipping is safe.
  const c = journal.cases[bountyId] || { bounty_id: bountyId, ...cfg, steps: {} };
  journal.cases[bountyId] = c;
  if (!c.steps) c.steps = {};
  save();
  const amount = cfg.amount_units;
  const stake = Math.min(10000, Math.max(1000, Math.floor(amount / 10)));

  // post
  if (!c.steps.post) {
    const r = await call(issuer, 'post_bounty',
      [bountyId, amount, cfg.min_reputation || 0, cfg.slug || SLUG, cfg.requirements],
      BigInt(amount) * WEI_PER_UNIT);
    okReceipt(r, `${bountyId} post`);
    setStep(c, 'post', r.hash);
  }
  // claim
  if (!c.steps.claim) {
    const r = await call(hunter, 'claim_bounty', [bountyId, 'xiaoyu7799'], BigInt(stake) * WEI_PER_UNIT);
    okReceipt(r, `${bountyId} claim`);
    setStep(c, 'claim', r.hash);
  }
  // pre-flight + mirror, then submit (read-only pre-flight is skipped too
  // when the submit is already recorded: merge_sha was checkpointed).
  if (!c.steps.submit) {
    const { mergeSha } = await preflightPr(bountyId, cfg);
    await mirrorPreflight(bountyId, cfg, mergeSha);
    const prUrl = `https://github.com/${cfg.slug || SLUG}/pull/${cfg.pr}`;
    const r = await call(hunter, 'submit_delivery',
      [bountyId, prUrl, cfg.note_path || '', cfg.note_text || '']);
    okReceipt(r, `${bountyId} submit`);
    setStep(c, 'submit', r.hash);
    c.pr_url = prUrl;
    c.merge_sha = mergeSha;
    save();
  }
  // evaluate
  if (!c.steps.evaluate) {
    const ev = await evaluateWithRetry(bountyId, 'evaluate_delivery', cfg.expected, bountyId);
    setStep(c, 'evaluate', ev.hash);
    c.verdict_round1 = ev.bounty.pending_verdict;
    save();
  }
  return c;
}

async function executeAndWithdraw(c, label) {
  // execute is skipped when recorded; the settlement is then re-read from
  // the chain. withdrawIfOwed is already idempotent (it only withdraws
  // when something is owed), so a resumed run never double-withdraws.
  if (!c.steps.execute) {
    const r = await call(issuer, 'execute_verdict', [c.bounty_id]);
    okReceipt(r, `${label} execute`);
    setStep(c, 'execute', r.hash);
  }
  const bounty = await getBounty(c.bounty_id);
  c.settlement = bounty.settlement;
  c.status = bounty.status;
  save();
  await checkConservation(`${label} settled`);
  const hunterTx = await withdrawIfOwed(hunter, `${label} hunter`);
  const issuerTx = await withdrawIfOwed(issuer, `${label} issuer`);
  if (hunterTx) setStep(c, 'withdraw_hunter', hunterTx);
  if (issuerTx) setStep(c, 'withdraw_issuer', issuerTx);
  await checkConservation(`${label} withdrawn`);
  c.readback = await getBounty(c.bounty_id);
  save();
  return bounty;
}

// -- cases ---------------------------------------------------------------------
// Pause between evaluate-heavy cases so the shared GitHub API quota
// (60/hour per egress IP) recovers: bb-0002 always runs after bb-0001
// has spent the pool, which is why it failed 10/10 in run 4 while
// bb-0001 got through.
async function pauseBetween(doneLabel, nextLabel) {
  // 300s, not 600s: three runs (3, 6, 9) were killed by runtime restarts
  // during these pauses, and the pause is only a secondary API-window
  // recovery — the evaluate retry backoff (120..600s) is the real safety
  // net. Shorter pauses cut ~15 min of wall time per run.
  console.log(JSON.stringify({ pause_between_cases: `${doneLabel} -> ${nextLabel}`, seconds: 300 }));
  await sleep(300000);
}

// Pause only when the preceding case submitted a tx in this process: on
// resume, a fully completed case replays as read-only no-ops and there is
// no API quota to recover, so the pause is skipped.
async function pauseIfWorked(txBefore, doneLabel, nextLabel) {
  if (journal.transactions.length > txBefore) await pauseBetween(doneLabel, nextLabel);
}

// bb-0001 ACCEPT
let txBefore = journal.transactions.length;
{
  const c = await runCase('bb-0001', PRS['bb-0001']);
  await executeAndWithdraw(c, 'bb-0001');
}
await pauseIfWorked(txBefore, 'bb-0001', 'bb-0002');
// bb-0002 PARTIAL
txBefore = journal.transactions.length;
{
  const c = await runCase('bb-0002', PRS['bb-0002']);
  await executeAndWithdraw(c, 'bb-0002');
}
await pauseIfWorked(txBefore, 'bb-0002', 'bb-0003');
// bb-0003 REJECT then challenge flip to ACCEPT
txBefore = journal.transactions.length;
{
  const c = await runCase('bb-0003', PRS['bb-0003']);
  // stranger must not be able to evaluate or execute
  if (!c.steps.stranger_evaluate_failed) {
    const strangerEval = await call(stranger, 'evaluate_delivery', ['bb-0003']);
    assert.notEqual(strangerEval.summary.leader_execution, 'SUCCESS', 'stranger evaluate must fail');
    setStep(c, 'stranger_evaluate_failed', strangerEval.hash);
  }
  // challenge with the new PR
  if (!c.steps.challenge) {
    const cfg2 = PRS['bb-0003-challenge'];
    const { mergeSha } = await preflightPr('bb-0003', cfg2);
    await mirrorPreflight('bb-0003', cfg2, mergeSha);
    const r = await call(hunter, 'challenge_verdict',
      ['bb-0003', `https://github.com/${SLUG}/pull/${cfg2.pr}`, cfg2.reason, 'ACCEPT']);
    okReceipt(r, 'bb-0003 challenge');
    setStep(c, 'challenge', r.hash);
  }
  // execution locked while challenged
  if (!c.steps.execute_blocked_during_challenge) {
    const blocked = await call(issuer, 'execute_verdict', ['bb-0003']);
    assert.notEqual(blocked.summary.leader_execution, 'SUCCESS', 'execute during challenge must fail');
    setStep(c, 'execute_blocked_during_challenge', blocked.hash);
  }
  if (!c.steps.resolve) {
    const ev = await evaluateWithRetry('bb-0003', 'resolve_challenge', 'ACCEPT', 'bb-0003-challenge');
    setStep(c, 'resolve', ev.hash);
    c.verdict_round2 = ev.bounty.pending_verdict;
    save();
  }
  await executeAndWithdraw(c, 'bb-0003');
}
await pauseIfWorked(txBefore, 'bb-0003', 'bb-0004');
// bb-0004 FAKE: self-merged PR in the hunter's own repository
{
  const c = await runCase('bb-0004', PRS['bb-0004']);
  await executeAndWithdraw(c, 'bb-0004');
  assert.equal(c.settlement.hunter_payout_units, 0, 'FAKE must pay the hunter nothing');
  assert.equal(c.settlement.issuer_refund_units, 11000, 'FAKE must refund bounty + slashed stake');
}
// bb-0005 cancel exit
{
  const c = journal.cases['bb-0005'] || { bounty_id: 'bb-0005', steps: {} };
  journal.cases['bb-0005'] = c;
  if (!c.steps) c.steps = {};
  if (!c.steps.post) {
    const r = await call(issuer, 'post_bounty',
      ['bb-0005', 5000, 0, SLUG, 'Cancelled bounty: verifies the OPEN exit.'],
      BigInt(5000) * WEI_PER_UNIT);
    okReceipt(r, 'bb-0005 post');
    setStep(c, 'post', r.hash);
  }
  if (!c.steps.cancel) {
    const r = await call(issuer, 'cancel_bounty', ['bb-0005']);
    okReceipt(r, 'bb-0005 cancel');
    setStep(c, 'cancel', r.hash);
  }
  c.readback = await getBounty('bb-0005');
  assert.equal(c.readback.status, 'CANCELLED');
  const w = await withdrawIfOwed(issuer, 'bb-0005 issuer');
  if (w) setStep(c, 'withdraw_issuer', w);
  save();
}
// failed payable: wrong value is rejected and credited back, never swallowed
{
  const c = journal.cases['bb-0006'] || { bounty_id: 'bb-0006', steps: {} };
  journal.cases['bb-0006'] = c;
  if (!c.steps) c.steps = {};
  if (!c.steps.rejected_post) {
    const r = await call(issuer, 'post_bounty',
      ['bb-0006', 10000, 0, SLUG, 'This bounty is never created: wrong value.'],
      BigInt(9999) * WEI_PER_UNIT);
    okReceipt(r, 'bb-0006 rejected post');
    setStep(c, 'rejected_post', r.hash);
  }
  let missing = false;
  try { await getBounty('bb-0006'); } catch { missing = true; }
  assert(missing, 'bb-0006 must not exist after a rejected post');
  const w = await getWithdrawable(issuer.address);
  // On resume the refund was already withdrawn, so nothing is owed; only
  // assert the credit on the first pass (when the refund is still owed).
  if (!c.steps.refund_withdraw) {
    assert.equal(BigInt(w.withdrawable_wei), BigInt(9999) * WEI_PER_UNIT, 'rejected value must be credited back');
    const withdrawTx = await withdrawIfOwed(issuer, 'bb-0006 refund');
    assert(withdrawTx, 'rejected value must be withdrawable');
    setStep(c, 'refund_withdraw', withdrawTx);
  }
  c.readback = { rejected_post_accepted: false, refund_withdrawn_wei: (BigInt(9999) * WEI_PER_UNIT).toString() };
  save();
}
// contradiction witness on the settled bb-0001 (settlement unchanged)
{
  const c = journal.cases['bb-0001'];
  if (!c.steps.contradiction) {
    const r = await call(stranger, 'record_contradiction_claim',
      ['bb-0001', 'REJECT', 'Witness: claims the delivery was unrelated.']);
    okReceipt(r, 'bb-0001 contradiction');
    setStep(c, 'contradiction', r.hash);
  }
  const bounty = await getBounty('bb-0001');
  assert.equal(bounty.status, 'SETTLED_ACCEPT', 'contradiction must not change settlement');
  assert.equal(bounty.contradictions.length, 1);
  save();
}

journal.finished_at = new Date().toISOString();
journal.final_totals = await getTotals();
journal.final_contract_balance_wei = (await contractBalance(CONTRACT)).toString();
await checkConservation('final');
save();

// Assemble evidence.json (the proof file linked from the README).
const evidence = {
  network: 'Stable Studionet', chain_id: 61999,
  contract: CONTRACT,
  contract_source_sha256: deployment.contractSha256,
  deploy_tx: deployment.deployTxHash,
  generated_at: new Date().toISOString(),
  cases: journal.cases,
  transactions: journal.transactions,
  final_totals: journal.final_totals,
  final_contract_balance_wei: journal.final_contract_balance_wei,
};
fs.writeFileSync('evidence/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
// Flow complete + evidence packaged: the checkpoint (with temp keys) is
// deleted immediately, per the checkpoint rule. A completed run leaves no
// checkpoint behind; a killed run keeps it for resume.
const checkpointDeleted = deleteCheckpoint();
console.log(JSON.stringify({ flow: 'DONE', contract: CONTRACT, cases: Object.keys(journal.cases), checkpoint_deleted: checkpointDeleted, checkpoint_path: CHECKPOINT_PATH }));
