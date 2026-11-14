import test from 'node:test';
import assert from 'node:assert/strict';
import { abi } from 'genlayer-js';
import { decodeWriteReturn } from '../site/src/write-result.js';

// Actual finalized Studionet return from the wrong-value test.
const rejected = 'AOQFeyJhY2NlcHRlZCI6ZmFsc2UsInJlYXNvbiI6IkJPVU5UWV9WQUxVRV9NSVNNQVRDSCIsInJlZnVuZGVkX2NyZWRpdF93ZWkiOjk5OTAwMDAwMDAwMDAwMDAwMH0=';
function result(value) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(abi.calldata.encode(JSON.stringify(value)))]).toString('base64');
}
test('a finalized successful transaction can carry a rejected payable call', () => {
  const payload = { accepted: false, reason: 'BOUNTY_VALUE_MISMATCH', refunded_credit_wei: '999000000000000000' };
  assert.deepEqual(decodeWriteReturn(result(payload)), payload);
  assert.equal(decodeWriteReturn(rejected).accepted, false);
  assert.equal(decodeWriteReturn(rejected).reason, 'BOUNTY_VALUE_MISMATCH');
});
test('successful action stays distinct from malformed or absent returns', () => {
  assert.deepEqual(decodeWriteReturn(result({ accepted: true })), { accepted: true });
  for (const value of [undefined, '', 'AQ==', result({ status: 'ok' })]) {
    assert.throws(() => decodeWriteReturn(value));
  }
});
