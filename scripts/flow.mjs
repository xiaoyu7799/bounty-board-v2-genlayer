// Evidence run for Bounty Board v2 on the deployed contract.
// Usage: node scripts/flow.mjs [evidence/prs.json]
//   prs.json maps bounty ids to { pr, note_path, note_text, expected }.
// Accounts are generated in process memory only; their keys are never
// written to disk. If this process dies, redeploy and rerun from scratch
// (a partial flow on the old contract is abandoned, never resumed with
// lost keys). Progress is journaled to evidence/flow.json (hashes and
// read-backs only — no keys).
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
import { createAccount } from 'genlayer-js';
import {
  RPC, GEN, WEI_PER_UNIT, validateChain, sendLocal, encoded,
  readJson, fundAndWait, contractBalance, waitFinalized, receiptSummary,
} from './network.mjs';

const deployment = JSON.parse(fs.readFileSync('evidence/deployment.json', 'utf8'));
const CONTRACT = deployment.contractAddress;
assert(CONTRACT, 'No contract address in evidence/deployment.json');
const prsFile = process.argv[2] || 'evidence/prs.json';
const PRS = JSON.parse(fs.readFileSync(prsFile, 'utf8'));
const SLUG = 'xiaoyu7799/bounty-board-v2-genlayer';
const GH = 'https://api.github.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await validateChain();

const issuer = createAccount();
const hunter = createAccount();
const stranger = createAccount();
console.log(JSON.stringify({ contract: CONTRACT, issuer: issuer.address, hunter: hunter.address, stranger: stranger.address }));

for (const account of [issuer, hunter, stranger]) {
  await fundAndWait(account, 50n * GEN);
}
console.log('funded issuer/hunter/stranger with 50 GEN each (testnet GEN)');

// -- journal ---------------------------------------------------------------
const journalFile = 'evidence/flow.json';
const journal = {
  network: 'Stable Studionet', chain_id: 61999, contract: CONTRACT,
  money: 'Real testnet GEN. Bounty amounts in units (1 unit = 0.001 GEN).',
  started_at: new Date().toISOString(),
  issuer: issuer.address, hunter: hunter.address, stranger: stranger.address,
  cases: {}, transactions: [],
};
const save = () => fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2) + '\n');
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
      return await fetch(url, {
        headers: { 'user-agent': 'bounty-board-v2-evidence' },
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
    const primary = await ghText(`https://raw.githubusercontent.com/${slug}/${mergeSha}/${cfg.note_path}`);
    const backup = await ghText(`https://cdn.jsdelivr.net/gh/${slug}@${mergeSha}/${cfg.note_path}`);
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
  const c = { bounty_id: bountyId, ...cfg, steps: {} };
  journal.cases[bountyId] = c;
  save();
  const amount = cfg.amount_units;
  const stake = Math.min(10000, Math.max(1000, Math.floor(amount / 10)));

  // post
  let r = await call(issuer, 'post_bounty',
    [bountyId, amount, cfg.min_reputation || 0, cfg.slug || SLUG, cfg.requirements],
    BigInt(amount) * WEI_PER_UNIT);
  okReceipt(r, `${bountyId} post`);
  c.steps.post = r.hash;
  // claim
  r = await call(hunter, 'claim_bounty', [bountyId, 'xiaoyu7799'], BigInt(stake) * WEI_PER_UNIT);
  okReceipt(r, `${bountyId} claim`);
  c.steps.claim = r.hash;
  // pre-flight + mirror, then submit
  const { mergeSha } = await preflightPr(bountyId, cfg);
  await mirrorPreflight(bountyId, cfg, mergeSha);
  const prUrl = `https://github.com/${cfg.slug || SLUG}/pull/${cfg.pr}`;
  r = await call(hunter, 'submit_delivery',
    [bountyId, prUrl, cfg.note_path || '', cfg.note_text || '']);
  okReceipt(r, `${bountyId} submit`);
  c.steps.submit = r.hash;
  c.pr_url = prUrl;
  c.merge_sha = mergeSha;
  // evaluate
  const ev = await evaluateWithRetry(bountyId, 'evaluate_delivery', cfg.expected, bountyId);
  c.steps.evaluate = ev.hash;
  c.verdict_round1 = ev.bounty.pending_verdict;
  save();
  return c;
}

async function executeAndWithdraw(c, label) {
  const r = await call(issuer, 'execute_verdict', [c.bounty_id]);
  okReceipt(r, `${label} execute`);
  c.steps.execute = r.hash;
  const bounty = await getBounty(c.bounty_id);
  c.settlement = bounty.settlement;
  c.status = bounty.status;
  await checkConservation(`${label} settled`);
  const hunterTx = await withdrawIfOwed(hunter, `${label} hunter`);
  const issuerTx = await withdrawIfOwed(issuer, `${label} issuer`);
  if (hunterTx) c.steps.withdraw_hunter = hunterTx;
  if (issuerTx) c.steps.withdraw_issuer = issuerTx;
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
  console.log(JSON.stringify({ pause_between_cases: `${doneLabel} -> ${nextLabel}`, seconds: 600 }));
  await sleep(600000);
}

// bb-0001 ACCEPT
{
  const c = await runCase('bb-0001', PRS['bb-0001']);
  await executeAndWithdraw(c, 'bb-0001');
}
await pauseBetween('bb-0001', 'bb-0002');
// bb-0002 PARTIAL
{
  const c = await runCase('bb-0002', PRS['bb-0002']);
  await executeAndWithdraw(c, 'bb-0002');
}
await pauseBetween('bb-0002', 'bb-0003');
// bb-0003 REJECT then challenge flip to ACCEPT
{
  const c = await runCase('bb-0003', PRS['bb-0003']);
  // stranger must not be able to evaluate or execute
  const strangerEval = await call(stranger, 'evaluate_delivery', ['bb-0003']);
  assert.notEqual(strangerEval.summary.leader_execution, 'SUCCESS', 'stranger evaluate must fail');
  c.steps.stranger_evaluate_failed = strangerEval.hash;
  // challenge with the new PR
  const cfg2 = PRS['bb-0003-challenge'];
  const { mergeSha } = await preflightPr('bb-0003', cfg2);
  await mirrorPreflight('bb-0003', cfg2, mergeSha);
  let r = await call(hunter, 'challenge_verdict',
    ['bb-0003', `https://github.com/${SLUG}/pull/${cfg2.pr}`, cfg2.reason, 'ACCEPT']);
  okReceipt(r, 'bb-0003 challenge');
  c.steps.challenge = r.hash;
  // execution locked while challenged
  const blocked = await call(issuer, 'execute_verdict', ['bb-0003']);
  assert.notEqual(blocked.summary.leader_execution, 'SUCCESS', 'execute during challenge must fail');
  c.steps.execute_blocked_during_challenge = blocked.hash;
  const ev = await evaluateWithRetry('bb-0003', 'resolve_challenge', 'ACCEPT', 'bb-0003-challenge');
  c.steps.resolve = ev.hash;
  c.verdict_round2 = ev.bounty.pending_verdict;
  await executeAndWithdraw(c, 'bb-0003');
}
await pauseBetween('bb-0003', 'bb-0004');
// bb-0004 FAKE: self-merged PR in the hunter's own repository
{
  const c = await runCase('bb-0004', PRS['bb-0004']);
  await executeAndWithdraw(c, 'bb-0004');
  assert.equal(c.settlement.hunter_payout_units, 0, 'FAKE must pay the hunter nothing');
  assert.equal(c.settlement.issuer_refund_units, 11000, 'FAKE must refund bounty + slashed stake');
}
// bb-0005 cancel exit
{
  const c = { bounty_id: 'bb-0005', steps: {} };
  journal.cases['bb-0005'] = c;
  let r = await call(issuer, 'post_bounty',
    ['bb-0005', 5000, 0, SLUG, 'Cancelled bounty: verifies the OPEN exit.'],
    BigInt(5000) * WEI_PER_UNIT);
  okReceipt(r, 'bb-0005 post');
  c.steps.post = r.hash;
  r = await call(issuer, 'cancel_bounty', ['bb-0005']);
  okReceipt(r, 'bb-0005 cancel');
  c.steps.cancel = r.hash;
  c.readback = await getBounty('bb-0005');
  assert.equal(c.readback.status, 'CANCELLED');
  const w = await withdrawIfOwed(issuer, 'bb-0005 issuer');
  if (w) c.steps.withdraw_issuer = w;
  save();
}
// failed payable: wrong value is rejected and credited back, never swallowed
{
  const c = { bounty_id: 'bb-0006', steps: {} };
  journal.cases['bb-0006'] = c;
  const r = await call(issuer, 'post_bounty',
    ['bb-0006', 10000, 0, SLUG, 'This bounty is never created: wrong value.'],
    BigInt(9999) * WEI_PER_UNIT);
  okReceipt(r, 'bb-0006 rejected post');
  c.steps.rejected_post = r.hash;
  let missing = false;
  try { await getBounty('bb-0006'); } catch { missing = true; }
  assert(missing, 'bb-0006 must not exist after a rejected post');
  const w = await getWithdrawable(issuer.address);
  assert.equal(BigInt(w.withdrawable_wei), BigInt(9999) * WEI_PER_UNIT, 'rejected value must be credited back');
  const withdrawTx = await withdrawIfOwed(issuer, 'bb-0006 refund');
  assert(withdrawTx, 'rejected value must be withdrawable');
  c.steps.refund_withdraw = withdrawTx;
  c.readback = { rejected_post_accepted: false, refund_withdrawn_wei: (BigInt(9999) * WEI_PER_UNIT).toString() };
  save();
}
// contradiction witness on the settled bb-0001 (settlement unchanged)
{
  const r = await call(stranger, 'record_contradiction_claim',
    ['bb-0001', 'REJECT', 'Witness: claims the delivery was unrelated.']);
  okReceipt(r, 'bb-0001 contradiction');
  journal.cases['bb-0001'].steps.contradiction = r.hash;
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
console.log(JSON.stringify({ flow: 'DONE', contract: CONTRACT, cases: Object.keys(journal.cases) }));
