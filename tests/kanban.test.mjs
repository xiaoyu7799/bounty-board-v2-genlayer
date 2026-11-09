// Tests for the kanban board module (pure HTML from a readback snapshot).
// Run: node --test tests/kanban.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  columnKeyForStatus, columnTitleKey, verdictTag, bountyCard, renderKanban,
} from '../site/src/kanban.js';

const STRINGS = {
  colOpen: 'Open', colClaimed: 'Claimed', colReview: 'In review', colSettled: 'Settled',
  unconfirmed: 'Unconfirmed', acceptedLabel: 'Accepted — full payout',
  partialLabel: 'Partial payout 60%', rejectedLabel: 'Rejected — bounty refunded',
  fakeLabel: 'Fake delivery — stake slashed',
  amount: 'Bounty', stake: 'Stake', issuer: 'Issuer', hunter: 'Hunter',
  targetRepo: 'Target repository', prLink: 'Delivery PR', githubPr: 'GitHub PR',
  verdict: 'Verdict', scores: 'Scores', evidenceHash: 'Evidence hash',
  payout: 'Hunter payout', refund: 'Issuer refund',
  pendingExecution: 'Pending execution — no payout yet',
  challengePending: 'Challenge pending — execution locked',
  empty: '—', genUnit: 'GEN',
};
const t = (key) => STRINGS[key] || key;

function bounty(overrides = {}) {
  return {
    bounty_id: 'bb-0003', status: 'OPEN', amount: 10000, stake: 1000,
    issuer: '0x' + '11'.repeat(20), claimed_by: '',
    expected_repo_slug: 'xiaoyu7799/bounty-board-v2-genlayer',
    requirements: 'Implement the kanban board UI.',
    delivery: null, pending_verdict: null, last_audit: null,
    settlement: null, challenge: null,
    ...overrides,
  };
}

test('columnKeyForStatus maps live statuses to four columns', () => {
  assert.equal(columnKeyForStatus('OPEN'), 'OPEN');
  assert.equal(columnKeyForStatus('CLAIMED'), 'CLAIMED');
  assert.equal(columnKeyForStatus('DELIVERED'), 'REVIEW');
  assert.equal(columnKeyForStatus('VERDICT_PENDING'), 'REVIEW');
  assert.equal(columnKeyForStatus('SETTLED_ACCEPT'), 'SETTLED');
  assert.equal(columnKeyForStatus('CANCELLED'), 'SETTLED');
});

test('columnTitleKey covers all four columns', () => {
  assert.equal(columnTitleKey('OPEN'), 'colOpen');
  assert.equal(columnTitleKey('CLAIMED'), 'colClaimed');
  assert.equal(columnTitleKey('REVIEW'), 'colReview');
  assert.equal(columnTitleKey('SETTLED'), 'colSettled');
});

test('verdictTag has one branch per tier, PARTIAL never looks successful', () => {
  assert.match(verdictTag({ verdict: 'ACCEPT' }, t), /Accepted/);
  const partial = verdictTag({ verdict: 'PARTIAL' }, t);
  assert.match(partial, /Partial payout 60%/);
  assert.doesNotMatch(partial, /Accepted/);
  assert.match(verdictTag({ verdict: 'REJECT' }, t), /Rejected/);
  assert.match(verdictTag({ verdict: 'FAKE' }, t), /Fake delivery/);
  assert.match(verdictTag(null, t), /Unconfirmed/);
});

test('bountyCard shows readback values and escapes requirements', () => {
  const html = bountyCard(bounty({
    status: 'CLAIMED',
    claimed_by: '0x' + '22'.repeat(20),
    requirements: 'Build <b>kanban</b> & ship it.',
  }), t);
  assert.match(html, /10\.000 GEN/);
  assert.match(html, /1\.000 GEN/);
  assert.match(html, /Build &lt;b&gt;kanban&lt;\/b&gt; &amp; ship it\./);
  assert.doesNotMatch(html, /<b>kanban<\/b>/);
});

test('renderKanban groups four columns and counts cards', () => {
  const bounties = {
    'bb-1': bounty({ bounty_id: 'bb-1', status: 'OPEN' }),
    'bb-2': bounty({ bounty_id: 'bb-2', status: 'CLAIMED' }),
    'bb-3': bounty({ bounty_id: 'bb-3', status: 'DELIVERED' }),
    'bb-4': bounty({ bounty_id: 'bb-4', status: 'VERDICT_PENDING' }),
    'bb-5': bounty({ bounty_id: 'bb-5', status: 'SETTLED_ACCEPT' }),
  };
  const html = renderKanban(bounties, t);
  assert.match(html, /Open <span class="count">1<\/span>/);
  assert.match(html, /Claimed <span class="count">1<\/span>/);
  assert.match(html, /In review <span class="count">2<\/span>/);
  assert.match(html, /Settled <span class="count">1<\/span>/);
  for (const id of ['bb-1', 'bb-2', 'bb-3', 'bb-4', 'bb-5']) {
    assert.ok(html.includes(id), `missing ${id}`);
  }
});
