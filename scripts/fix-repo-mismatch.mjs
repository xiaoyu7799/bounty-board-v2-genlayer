// Fix for independent-verification repository mismatch (historical Bounty Board v2).
//
// The REPO_MISMATCH gate was never exercised on-chain: bb-0004's bounty
// targeted the fake repository itself, so its FAKE came from
// INSUFFICIENT_CODE_CHANGE (0 code files / 0 lines), not from the repo
// gate. This script posts ONE more bounty on the live contract, targeting
// the real repository (xiaoyu7799/bounty-board-v2-genlayer), delivers the
// fake-repo PR (xiaoyu7799/bounty-fake-delivery/pull/1, merge 06fba44),
// and expects FAKE via REPO_MISMATCH.
//
// No redeploy: the contract is the live run-10 deployment in
// evidence/deployment.json. Fresh temp accounts (faucet GEN). Checkpoint /
// resume uses the same workdir checkpoint.json as flow.mjs (0600, deleted
// on DONE); a killed run resumes from the first unfinished step.
//
// Usage (from repo root): node scripts/fix-repo-mismatch.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccount, generatePrivateKey } from 'genlayer-js';
import {
  GEN, WEI_PER_UNIT, validateChain, sendLocal, encoded,
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
const SLUG = 'xiaoyu7799/bounty-board-v2-genlayer';
const FAKE_SLUG = 'xiaoyu7799/bounty-fake-delivery';
const FAKE_PR = 1;
const FAKE_MERGE_SHA = '06fba4445fbacc760c794679017e95493cfce90d';
const BOUNTY_ID = 'bb-0007';
const AMOUNT = 10000; // units = 10 GEN; stake = 1000 units = 1 GEN
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await validateChain();

// Canonical JSON packing, same as the contract's _pack():
// json.dumps(sort_keys=True, separators=(',', ':')).
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}
const expectedGateHash = createHash('sha256').update(
  canonical({ gate: 'REPO_MISMATCH', slug: FAKE_SLUG, expected: SLUG, pr: FAKE_PR }),
).digest('hex');
console.log(JSON.stringify({ expected_gate_hash: expectedGateHash }));

// -- checkpoint / resume (same format as flow.mjs) ---------------------------
let resumed = null;
{
  let cp = null;
  try {
    cp = readCheckpoint();
  } catch (e) {
    console.log(JSON.stringify({ checkpoint: 'discarded', reason: `UNREADABLE:${String(e.message || e).slice(0, 80)}` }));
    deleteCheckpoint();
  }
  if (cp) {
    if (cp.contract !== CONTRACT) {
      console.log(JSON.stringify({ checkpoint: 'discarded', reason: 'CONTRACT_MISMATCH' }));
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

let issuerKey; let hunterKey;
let issuer; let hunter;
if (resumed) {
  issuerKey = resumed.accounts.issuer.privateKey;
  hunterKey = resumed.accounts.hunter.privateKey;
} else {
  issuerKey = generatePrivateKey();
  hunterKey = generatePrivateKey();
}
issuer = createAccount(issuerKey);
hunter = createAccount(hunterKey);
console.log(JSON.stringify({ contract: CONTRACT, issuer: issuer.address, hunter: hunter.address, resumed: Boolean(resumed) }));

const journalFile = 'evidence/flow-bb0007.json';
const journal = resumed ? {
  network: 'Stable Studionet', chain_id: 61999, contract: CONTRACT,
  money: 'Real testnet GEN. Bounty amounts in units (1 unit = 0.001 GEN).',
  started_at: resumed.started_at,
  resumed_at: new Date().toISOString(),
  issuer: issuer.address, hunter: hunter.address,
  cases: resumed.cases || {}, transactions: resumed.transactions || [],
} : {
  network: 'Stable Studionet', chain_id: 61999, contract: CONTRACT,
  money: 'Real testnet GEN. Bounty amounts in units (1 unit = 0.001 GEN).',
  started_at: new Date().toISOString(),
  issuer: issuer.address, hunter: hunter.address,
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

function setStep(c, name, hash) {
  c.steps[name] = hash;
  save();
}

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
await fundIfNeeded(issuer, 'issuer');
await fundIfNeeded(hunter, 'hunter');
save();

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

// -- light preflight of the fake PR (no commit-id check: the repo gate
// fires before the commit gate, and the fake PR's commits mention bb-0004,
// not bb-0007 — that is exactly the point: the PR is from another repo).
async function fetchRetry(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
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
const pr = await (async () => {
  const res = await fetchRetry(`https://api.github.com/repos/${FAKE_SLUG}/pulls/${FAKE_PR}`);
  if (!res.ok) throw Error(`GITHUB_API_FAILED:${res.status}`);
  return res.json();
})();
assert.equal(pr.merged, true, 'fake PR not merged');
assert.equal(String(pr.user.login).toLowerCase(), 'xiaoyu7799', 'fake PR author mismatch');
assert.equal(String(pr.merge_commit_sha).toLowerCase(), FAKE_MERGE_SHA, 'fake PR merge sha mismatch');
console.log(JSON.stringify({ preflight: BOUNTY_ID, pr: FAKE_PR, merged: true, merge_sha: pr.merge_commit_sha }));

// -- the case ----------------------------------------------------------------
const c = journal.cases[BOUNTY_ID] || {
  bounty_id: BOUNTY_ID,
  amount_units: AMOUNT,
  expect_gate_pass: false,
  expected: 'FAKE',
  expected_gate: 'REPO_MISMATCH',
  min_reputation: 0,
  note_path: '',
  note_text: 'Self-merged PR in my own repository.',
  pr: FAKE_PR,
  requirements: 'Add a status badge component for bounty cards showing the settlement tier.',
  slug: FAKE_SLUG, // delivery PR's repository
  expected_repo_slug: SLUG, // bounty target repository
  steps: {},
};
journal.cases[BOUNTY_ID] = c;
if (!c.steps) c.steps = {};
save();
const stake = Math.min(10000, Math.max(1000, Math.floor(AMOUNT / 10)));

// post: bounty targets the REAL repository
if (!c.steps.post) {
  const r = await call(issuer, 'post_bounty',
    [BOUNTY_ID, AMOUNT, 0, SLUG, c.requirements],
    BigInt(AMOUNT) * WEI_PER_UNIT);
  okReceipt(r, `${BOUNTY_ID} post`);
  setStep(c, 'post', r.hash);
}
// claim
if (!c.steps.claim) {
  const r = await call(hunter, 'claim_bounty', [BOUNTY_ID, 'xiaoyu7799'], BigInt(stake) * WEI_PER_UNIT);
  okReceipt(r, `${BOUNTY_ID} claim`);
  setStep(c, 'claim', r.hash);
}
// submit: the delivery PR lives in the FAKE repository
if (!c.steps.submit) {
  const prUrl = `https://github.com/${FAKE_SLUG}/pull/${FAKE_PR}`;
  const r = await call(hunter, 'submit_delivery', [BOUNTY_ID, prUrl, '', c.note_text]);
  okReceipt(r, `${BOUNTY_ID} submit`);
  setStep(c, 'submit', r.hash);
  c.pr_url = prUrl;
  c.merge_sha = FAKE_MERGE_SHA;
  save();
}
// evaluate: expect FAKE via REPO_MISMATCH. The gate returns before any
// GitHub fetch, so consensus is deterministic; retries only on a
// FINALIZED error / no-majority receipt, never on a wrong verdict.
if (!c.steps.evaluate) {
  let evaluated = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const { hash, receipt, summary } = await call(issuer, 'evaluate_delivery', [BOUNTY_ID]);
    if (receipt.status === 'FINALIZED' && receipt.result_name === 'MAJORITY_AGREE' &&
        summary.leader_execution === 'SUCCESS') {
      const bounty = await getBounty(BOUNTY_ID);
      const verdict = bounty.pending_verdict?.verdict;
      console.log(JSON.stringify({ evaluate: BOUNTY_ID, attempt, hash, verdict }));
      if (verdict !== 'FAKE') {
        throw Error(`UNEXPECTED_VERDICT:${BOUNTY_ID}:expected FAKE, got ${verdict}: ${hash}`);
      }
      evaluated = { hash, bounty };
      break;
    }
    const gapS = Math.min(120 * attempt, 600);
    console.log(JSON.stringify({ evaluate: BOUNTY_ID, attempt, hash, ...summary, retry_in_s: gapS }));
    await sleep(gapS * 1000);
  }
  if (!evaluated) throw Error(`EVALUATE_RETRY_EXHAUSTED:${BOUNTY_ID}`);
  setStep(c, 'evaluate', evaluated.hash);
  c.verdict_round1 = evaluated.bounty.pending_verdict;
  save();
}

// Prove the gate that fired: the audit must carry the REPO_MISMATCH
// rationale and the exact evidence hash for that gate, not any other gate.
{
  const audit = c.verdict_round1;
  assert.equal(audit.verdict, 'FAKE', 'verdict must be FAKE');
  assert.equal(audit.rationale, 'PR is not in the bounty target repository.', `wrong gate rationale: ${audit.rationale}`);
  assert.equal(audit.evidence_hash, expectedGateHash, `evidence_hash is not the REPO_MISMATCH gate hash: ${audit.evidence_hash}`);
  assert.equal(audit.completeness_score, 0, 'FAKE scores must be 0');
  assert.equal(audit.scope_fit_score, 0, 'FAKE scores must be 0');
  assert.equal(audit.quality_score, 0, 'FAKE scores must be 0');
  assert.equal(audit.pr_number, FAKE_PR, 'pr_number must be the fake PR');
  assert.equal(audit.merge_sha, '', 'REPO_MISMATCH returns before reading the merge SHA');
  assert.equal(audit.author_match, false, 'author gate not reached');
  assert.equal(audit.file_count, 0, 'file gate not reached');
  assert.equal(audit.changed_lines, 0, 'file gate not reached');
  assert.equal(audit.commit_hit, false, 'commit gate not reached');
  console.log(JSON.stringify({ gate_proof: BOUNTY_ID, gate: 'REPO_MISMATCH', evidence_hash: audit.evidence_hash, rationale: audit.rationale }));
}

// execute + settle + withdraw
if (!c.steps.execute) {
  const r = await call(issuer, 'execute_verdict', [BOUNTY_ID]);
  okReceipt(r, `${BOUNTY_ID} execute`);
  setStep(c, 'execute', r.hash);
}
{
  const bounty = await getBounty(BOUNTY_ID);
  c.settlement = bounty.settlement;
  c.status = bounty.status;
  save();
  assert.equal(bounty.status, 'SETTLED_FAKE', `status must be SETTLED_FAKE, got ${bounty.status}`);
  assert.equal(bounty.settlement.hunter_payout_units, 0, 'FAKE must pay the hunter nothing');
  assert.equal(bounty.settlement.issuer_refund_units, 11000, 'FAKE must refund bounty + slashed stake');
  assert.equal(bounty.settlement.reputation_delta, -10, 'FAKE reputation delta must be -10');
  await checkConservation(`${BOUNTY_ID} settled`);
  const hunterTx = await withdrawIfOwed(hunter, `${BOUNTY_ID} hunter`);
  const issuerTx = await withdrawIfOwed(issuer, `${BOUNTY_ID} issuer`);
  if (hunterTx) setStep(c, 'withdraw_hunter', hunterTx);
  if (issuerTx) setStep(c, 'withdraw_issuer', issuerTx);
  await checkConservation(`${BOUNTY_ID} withdrawn`);
  c.readback = await getBounty(BOUNTY_ID);
  c.hunter_record = await readJson(CONTRACT, 'get_hunter', [hunter.address]);
  save();
}

journal.finished_at = new Date().toISOString();
journal.final_totals = await getTotals();
journal.final_contract_balance_wei = (await contractBalance(CONTRACT)).toString();
await checkConservation('final');
save();

// Append the case to the repo evidence (evidence.json + flow.json) so the
// repo's own verify.mjs and any independent verifier re-read it.
{
  const evidence = JSON.parse(fs.readFileSync('evidence/evidence.json', 'utf8'));
  assert(!evidence.cases[BOUNTY_ID], 'bb-0007 already in evidence.json');
  evidence.cases[BOUNTY_ID] = c;
  evidence.transactions.push(...journal.transactions);
  evidence.final_totals = journal.final_totals;
  evidence.final_contract_balance_wei = journal.final_contract_balance_wei;
  evidence.generated_at = new Date().toISOString();
  fs.writeFileSync('evidence/evidence.json', JSON.stringify(evidence, null, 2) + '\n');

  const flowJournal = JSON.parse(fs.readFileSync('evidence/flow.json', 'utf8'));
  assert(!flowJournal.cases[BOUNTY_ID], 'bb-0007 already in flow.json');
  flowJournal.cases[BOUNTY_ID] = c;
  flowJournal.transactions.push(...journal.transactions);
  flowJournal.bb0007_appended_at = new Date().toISOString();
  fs.writeFileSync('evidence/flow.json', JSON.stringify(flowJournal, null, 2) + '\n');
}

const checkpointDeleted = deleteCheckpoint();
console.log(JSON.stringify({
  flow: 'DONE', contract: CONTRACT, case: BOUNTY_ID,
  verdict: 'FAKE', gate: 'REPO_MISMATCH',
  steps: c.steps, settlement: c.settlement,
  final_totals: journal.final_totals,
  checkpoint_deleted: checkpointDeleted, checkpoint_path: CHECKPOINT_PATH,
}));
