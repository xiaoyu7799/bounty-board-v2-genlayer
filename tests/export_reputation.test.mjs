// Tests for the JSON reputation export (format + ranking only; the chain
// read itself is covered by the live evidence run).
// Run: node --test tests/export_reputation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReputationJson, rankHunters, summarizeHunters, parseExportArgs,
} from '../scripts/export_reputation.mjs';

const hunters = [
  { address: '0x' + '11'.repeat(20), reputation: 5, settled: 2, accepted: 1, partial: 1, rejected: 0, fake: 0 },
  { address: '0x' + '22'.repeat(20), reputation: 12, settled: 3, accepted: 3, partial: 0, rejected: 0, fake: 0 },
  { address: '0x' + '33'.repeat(20), reputation: 5, settled: 4, accepted: 2, partial: 2, rejected: 0, fake: 0 },
];

test('formatReputationJson keeps every readback field', () => {
  const parsed = JSON.parse(formatReputationJson(hunters));
  assert.equal(parsed.hunters.length, 3);
  // Rows are ranked: the first row is the highest-reputation hunter.
  const first = parsed.hunters[0];
  assert.equal(first.address, hunters[1].address);
  assert.equal(first.reputation, 12);
  assert.equal(first.settled, 3);
  assert.equal(first.accepted, 3);
  assert.equal(first.fake, 0);
  assert.ok(parsed.exported_at);
  assert.equal(parsed.summary.hunters, 3);
});

test('rankHunters orders by reputation, then settled count', () => {
  const ranked = rankHunters(hunters);
  assert.equal(ranked[0].address, hunters[1].address);
  assert.equal(ranked[1].address, hunters[2].address);
  assert.equal(ranked[2].address, hunters[0].address);
});

test('summarizeHunters totals reputation, settled counts, and tier mix', () => {
  const summary = summarizeHunters(rankHunters(hunters));
  assert.equal(summary.hunters, 3);
  assert.equal(summary.reputation_total, 22);
  assert.equal(summary.settled_total, 9);
  assert.equal(summary.tiers.accepted, 6);
  assert.equal(summary.tiers.partial, 3);
  assert.equal(summary.top_reputation, 12);
  assert.deepEqual(summary.hunters_with_fake_verdicts, []);
});

test('summarizeHunters flags hunters with fake verdicts', () => {
  const flagged = [...hunters, {
    address: '0x' + '44'.repeat(20), reputation: 0, settled: 1,
    accepted: 0, partial: 0, rejected: 0, fake: 1,
  }];
  const summary = summarizeHunters(rankHunters(flagged));
  assert.deepEqual(summary.hunters_with_fake_verdicts, ['0x' + '44'.repeat(20)]);
  assert.equal(summary.tiers.fake, 1);
});

test('formatReputationJson --top limits rows but the summary covers all', () => {
  const parsed = JSON.parse(formatReputationJson(hunters, { top: 1 }));
  assert.equal(parsed.hunters.length, 1);
  assert.equal(parsed.hunters[0].reputation, 12);
  assert.equal(parsed.summary.hunters, 3);
  assert.equal(parsed.summary.reputation_total, 22);
});

test('formatReputationJson --compact writes a single line', () => {
  const text = formatReputationJson(hunters, { compact: true });
  assert.equal(text.trim().split('\n').length, 1);
  assert.equal(JSON.parse(text).summary.settled_total, 9);
});

test('parseExportArgs reads --top and --compact', () => {
  const args = parseExportArgs(['0xabc', 'out.json', '--top', '2', '--compact', '0xdef']);
  assert.equal(args.top, 2);
  assert.equal(args.compact, true);
  assert.deepEqual(args.positional, ['0xabc', 'out.json', '0xdef']);
  assert.throws(() => parseExportArgs(['--top', 'zero']), /INVALID_TOP/);
  assert.throws(() => parseExportArgs(['--top']), /MISSING_TOP_VALUE/);
});
