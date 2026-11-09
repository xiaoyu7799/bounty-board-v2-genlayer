// Tests for the JSON reputation export (format + ranking only; the chain
// read itself is covered by the live evidence run).
// Run: node --test tests/export_reputation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReputationJson, rankHunters } from '../scripts/export_reputation.mjs';

const hunters = [
  { address: '0x' + '11'.repeat(20), reputation: 5, settled: 2, accepted: 1, partial: 1, rejected: 0, fake: 0 },
  { address: '0x' + '22'.repeat(20), reputation: 12, settled: 3, accepted: 3, partial: 0, rejected: 0, fake: 0 },
  { address: '0x' + '33'.repeat(20), reputation: 5, settled: 4, accepted: 2, partial: 2, rejected: 0, fake: 0 },
];

test('formatReputationJson keeps every readback field', () => {
  const parsed = JSON.parse(formatReputationJson(hunters));
  assert.equal(parsed.hunters.length, 3);
  assert.equal(parsed.hunters[0].address, hunters[0].address);
  assert.equal(parsed.hunters[0].reputation, 5);
  assert.equal(parsed.hunters[0].settled, 2);
  assert.equal(parsed.hunters[0].accepted, 1);
  assert.equal(parsed.hunters[0].fake, 0);
  assert.ok(parsed.exported_at);
});

test('rankHunters orders by reputation, then settled count', () => {
  const ranked = rankHunters(hunters);
  assert.equal(ranked[0].address, hunters[1].address);
  assert.equal(ranked[1].address, hunters[2].address);
  assert.equal(ranked[2].address, hunters[0].address);
});
