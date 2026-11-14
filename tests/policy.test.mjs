import test from 'node:test';
import assert from 'node:assert/strict';
import { genToUnits, unitsToWei, stakeForUnits, formatWeiAsGen } from '../site/src/amounts.js';
import { verdictActions, challengeTimeRemaining } from '../site/src/deadlines.js';

const pending = { status: 'VERDICT_PENDING', challenge_deadline: 1000,
  challenge: null, challenge_count: 0 };

test('amount parsing preserves exact thousandths and range', () => {
  assert.equal(genToUnits('1.001'), 1001);
  assert.equal(genToUnits('200.000'), 200000);
  assert.equal(genToUnits('10'), 10000);
  for (const invalid of ['0.999', '200.001', '1.0001', '1e2', '-1', 'NaN', '']) {
    assert.throws(() => genToUnits(invalid));
  }
});

test('wei conversion rejects fractional or unsafe contract units', () => {
  assert.equal(unitsToWei(1001), 1001000000000000000n);
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => unitsToWei(invalid));
  }
});

test('stake clamp is identical to the contract policy', () => {
  assert.equal(stakeForUnits(1000), 1000);
  assert.equal(stakeForUnits(50000), 5000);
  assert.equal(stakeForUnits(200000), 10000);
  assert.throws(() => stakeForUnits(999));
});

test('large balances format without floating-point precision loss', () => {
  assert.equal(formatWeiAsGen(9007199254740993001000000000000000n), '9007199254740993.001');
  assert.equal(formatWeiAsGen(1n), '0.000');
  assert.throws(() => formatWeiAsGen(-1n));
});

test('deadline boundary enables exactly one of challenge and execution', () => {
  assert.deepEqual(verdictActions(pending, 999, true), {
    evaluate: false, challenge: true, resolve: false, execute: false,
  });
  assert.deepEqual(verdictActions(pending, 1000, true), {
    evaluate: false, challenge: false, resolve: false, execute: true,
  });
});

test('pending challenges always block execution and permit public resolution', () => {
  const challenged = { ...pending, challenge: { new_pr_url: 'https://github.com/a/b/pull/1' } };
  const actions = verdictActions(challenged, 5000, false);
  assert.equal(actions.resolve, true);
  assert.equal(actions.execute, false);
  assert.equal(actions.challenge, false);
});

test('challenge limit and stranger role cannot create a challenge', () => {
  assert.equal(verdictActions({ ...pending, challenge_count: 2 }, 999, true).challenge, false);
  assert.equal(verdictActions(pending, 999, false).challenge, false);
  assert.equal(verdictActions(pending, 1000, false).execute, true);
});

test('missing historical deadline disables execution and invalid clocks fail', () => {
  assert.equal(verdictActions({ ...pending, challenge_deadline: undefined }, 5000, true).execute, false);
  assert.throws(() => verdictActions(pending, NaN, true));
  assert.equal(challengeTimeRemaining(pending, 998.2), 2);
  assert.equal(challengeTimeRemaining(pending, 1001), 0);
  assert.equal(challengeTimeRemaining({ status: 'OPEN' }, 1001), null);
});
