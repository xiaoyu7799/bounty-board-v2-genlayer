// Dossier tests: the export is built ONLY from a FINALIZED readback.
// Run: node --test tests/dossier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDossier } from '../site/src/dossier.js';

function settledBounty(verdict, payoutUnits = 11000, refundUnits = 0) {
  return {
    bounty_id: 'bb-0001',
    status: 'SETTLED_' + verdict,
    issuer: '0x' + '11'.repeat(20),
    claimed_by: '0x' + '22'.repeat(20),
    hunter_github_login: 'xiaoyu7799',
    amount: 10000,
    stake: 1000,
    expected_repo_slug: 'xiaoyu7799/bounty-board-v2-genlayer',
    requirements: 'Build the frontend.',
    delivery: { pr_url: 'https://github.com/xiaoyu7799/bounty-board-v2-genlayer/pull/1', pr_number: 1, note_path: 'deliveries/bb-0001.md' },
    last_audit: {
      verdict, completeness_score: 90, scope_fit_score: 90, quality_score: 85,
      evidence_hash: 'ab'.repeat(32), pr_number: 1, merge_sha: 'a'.repeat(40),
      author_match: true, file_count: 2, changed_lines: 120, commit_hit: true,
      rationale: 'Meets the requirements.', round: 1,
    },
    settlement: {
      verdict, hunter_payout_units: payoutUnits, issuer_refund_units: refundUnits,
      hunter_payout_wei: payoutUnits * 10 ** 15, issuer_refund_wei: refundUnits * 10 ** 15,
      reputation_delta: 5,
    },
  };
}

const hunter = {
  address: '0x' + '22'.repeat(20), reputation: 5, settled: 1,
  accepted: 1, partial: 0, rejected: 0, fake: 0,
};
const totals = {
  total_received_wei: 11000 * 10 ** 15, total_withdrawn_wei: 0,
  withdrawable_wei: 11000 * 10 ** 15, escrowed_wei: 0,
};

test('ACCEPT dossier exports readback fields verbatim', () => {
  const bounty = settledBounty('ACCEPT');
  const result = buildDossier({ bounty, hunter, totals, readBackAt: '2026-11-10T00:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.dossier.audit.verdict, 'ACCEPT');
  assert.equal(result.dossier.audit.completeness_score, 90);
  assert.equal(result.dossier.audit.evidence_hash, 'ab'.repeat(32));
  assert.equal(result.dossier.settlement.hunter_payout_units, 11000);
  assert.equal(result.dossier.outcome.success_marker, true);
  assert.equal(result.dossier.hunter.reputation, 5);
  assert.equal(result.dossier.ledger_totals_wei.total_received_wei, 11000 * 10 ** 15);
});

test('PARTIAL dossier is its own branch: 60% payout, no success marker', () => {
  const bounty = settledBounty('PARTIAL', 7000, 4000);
  bounty.last_audit.completeness_score = 65;
  bounty.last_audit.scope_fit_score = 60;
  bounty.last_audit.quality_score = 50;
  const result = buildDossier({ bounty, hunter, totals, readBackAt: '2026-11-10T00:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.dossier.audit.verdict, 'PARTIAL');
  assert.equal(result.dossier.settlement.hunter_payout_units, 7000);
  assert.equal(result.dossier.settlement.issuer_refund_units, 4000);
  assert.equal(result.dossier.outcome.success_marker, false);
  assert.equal(result.dossier.outcome.tier, 'PARTIAL');
});

test('FAKE dossier carries the slash, no success marker', () => {
  const bounty = settledBounty('FAKE', 0, 11000);
  bounty.last_audit.completeness_score = 0;
  bounty.last_audit.scope_fit_score = 0;
  bounty.last_audit.quality_score = 0;
  const result = buildDossier({ bounty, hunter, totals, readBackAt: '2026-11-10T00:00:00.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.dossier.outcome.tier, 'FAKE');
  assert.equal(result.dossier.outcome.success_marker, false);
  assert.equal(result.dossier.settlement.issuer_refund_units, 11000);
});

test('no readback, or no settled audit, refuses the export', () => {
  assert.equal(buildDossier({ bounty: null, hunter, totals }).ok, false);
  const pending = settledBounty('ACCEPT');
  delete pending.last_audit;
  pending.status = 'VERDICT_PENDING';
  assert.equal(buildDossier({ bounty: pending, hunter, totals }).ok, false);
  assert.equal(buildDossier({ bounty: settledBounty('ACCEPT'), hunter: null, totals }).ok, false);
});
