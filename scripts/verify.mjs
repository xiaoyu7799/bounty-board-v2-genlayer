// Independent re-verification of evidence/evidence.json.
// Re-fetches every recorded transaction receipt and every case read-back
// from the chain, and checks them against the recorded values.
// Usage: node scripts/verify.mjs
// Writes evidence/verification.json. Exit 1 on any mismatch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rpc, readJson, contractBalance, receiptSummary } from './network.mjs';

const deployment = JSON.parse(fs.readFileSync('evidence/deployment.json', 'utf8'));
const evidence = JSON.parse(fs.readFileSync('evidence/evidence.json', 'utf8'));
const CONTRACT = deployment.contractAddress;
const results = { contract: CONTRACT, checked_at: new Date().toISOString(), checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`);
  if (!ok) results.failed = true;
};

// 1. Deployed code matches the repo source.
const deployed = await rpc('gen_getContractCode', [CONTRACT]);
const decoded = Buffer.from(deployed, 'base64').toString('utf8');
const deployedSha = createHash('sha256').update(decoded).digest('hex');
const sourceSha = createHash('sha256').update(fs.readFileSync('contracts/bounty_board.py')).digest('hex');
check('deployed code SHA == repo source SHA', deployedSha === sourceSha, deployedSha);

// 2. Every recorded transaction is FINALIZED. What "good" means depends on
// the journal (evidence/flow.json):
//   - a step named *_failed / *_blocked is a deliberate negative test:
//     it must have FAILED (not MAJORITY_AGREE+SUCCESS);
//   - a tx no case step references is a superseded retry attempt: it must
//     merely be FINALIZED (its MAJORITY_DISAGREE is why it was retried);
//   - every other tx is a final step and must be FINALIZED+MAJORITY_AGREE+SUCCESS.
const journal = JSON.parse(fs.readFileSync('evidence/flow.json', 'utf8'));
const expectedFailed = new Set();
const finalSteps = new Set();
for (const c of Object.values(journal.cases)) {
  for (const [name, hash] of Object.entries(c.steps || {})) {
    if (/_failed|_blocked/.test(name)) expectedFailed.add(hash);
    else finalSteps.add(hash);
  }
}
for (const tx of evidence.transactions) {
  const receipt = await rpc('eth_getTransactionByHash', [tx.hash]);
  const summary = receiptSummary(receipt);
  const finalized = receipt?.status === 'FINALIZED';
  const success = finalized && receipt?.result_name === 'MAJORITY_AGREE' &&
    summary.leader_execution === 'SUCCESS';
  if (expectedFailed.has(tx.hash)) {
    check(`tx ${tx.method} ${tx.hash.slice(0, 18)}… FINALIZED+expected-failure`,
      finalized && !success,
      `${receipt?.status}/${receipt?.result_name}/${summary.leader_execution}`);
  } else if (!finalSteps.has(tx.hash)) {
    check(`tx ${tx.method} ${tx.hash.slice(0, 18)}… FINALIZED (superseded retry)`,
      finalized,
      `${receipt?.status}/${receipt?.result_name}/${summary.leader_execution}`);
  } else {
    check(`tx ${tx.method} ${tx.hash.slice(0, 18)}… FINALIZED+MAJORITY_AGREE+SUCCESS`,
      success,
      `${receipt?.status}/${receipt?.result_name}/${summary.leader_execution}`);
  }
}

// 3. Every case read-back matches the live chain state.
for (const [id, c] of Object.entries(evidence.cases)) {
  if (!c.readback || typeof c.readback !== 'object' || !c.readback.status) continue;
  const live = await readJson(CONTRACT, 'get_bounty', [id]);
  check(`readback ${id} status ${c.readback.status}`,
    live.status === c.readback.status, `live=${live.status}`);
  if (c.settlement) {
    check(`readback ${id} settlement verdict ${c.settlement.verdict}`,
      live.settlement?.verdict === c.settlement.verdict, `live=${live.settlement?.verdict}`);
    check(`readback ${id} hunter payout ${c.settlement.hunter_payout_units}`,
      live.settlement?.hunter_payout_units === c.settlement.hunter_payout_units,
      `live=${live.settlement?.hunter_payout_units}`);
    check(`readback ${id} issuer refund ${c.settlement.issuer_refund_units}`,
      live.settlement?.issuer_refund_units === c.settlement.issuer_refund_units,
      `live=${live.settlement?.issuer_refund_units}`);
  }
  if (c.verdict_round1) {
    check(`readback ${id} round-1 verdict ${c.verdict_round1.verdict}`,
      live.rounds?.[0]?.verdict === c.verdict_round1.verdict,
      `live=${live.rounds?.[0]?.verdict}`);
  }
  if (c.verdict_round2) {
    check(`readback ${id} round-2 verdict ${c.verdict_round2.verdict}`,
      live.rounds?.[1]?.verdict === c.verdict_round2.verdict,
      `live=${live.rounds?.[1]?.verdict}`);
  }
}

// 4. Conservation holds on the live totals and the contract balance.
const totals = await readJson(CONTRACT, 'get_ledger_totals', []);
const received = BigInt(totals.total_received_wei);
const withdrawn = BigInt(totals.total_withdrawn_wei);
const withdrawable = BigInt(totals.withdrawable_wei);
const escrowed = BigInt(totals.escrowed_wei);
check('conservation received == withdrawn + withdrawable + escrowed',
  received === withdrawn + withdrawable + escrowed,
  `${received} vs ${withdrawn + withdrawable + escrowed}`);
check('escrowed == escrowed recomputed',
  escrowed === BigInt(totals.escrowed_wei_recomputed),
  `${escrowed} vs ${totals.escrowed_wei_recomputed}`);
const balance = BigInt(await contractBalance(CONTRACT));
check('contract balance == received - withdrawn',
  balance === received - withdrawn, `${balance} vs ${received - withdrawn}`);

results.failed = results.checks.some((c) => !c.ok);
fs.writeFileSync('evidence/verification.json', JSON.stringify(results, null, 2) + '\n');
console.log(results.failed ? 'VERIFICATION FAILED' : 'VERIFICATION PASSED');
process.exit(results.failed ? 1 : 0);
