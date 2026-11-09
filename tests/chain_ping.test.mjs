// Tests for the chain connectivity check (pure checks + scripted fetch).
// Run: node --test tests/chain_ping.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkChainId, checkGasPrice, formatPingReport, pingChain,
} from '../scripts/chain_ping.mjs';

test('checkChainId accepts 61999 and rejects anything else', () => {
  assert.equal(checkChainId('0xf22f').ok, true);
  assert.equal(checkChainId('0xf22f').reported, 61999);
  assert.equal(checkChainId('0x1').ok, false);
  assert.equal(checkChainId('0x1').expected, 61999);
});

test('checkGasPrice reports zero gas on Studionet', () => {
  assert.equal(checkGasPrice('0x0').is_zero, true);
  assert.equal(checkGasPrice('0x0').wei, '0');
  assert.equal(checkGasPrice('0x3b9aca00').is_zero, false);
});

test('formatPingReport collects failed checks', () => {
  const report = formatPingReport([
    { name: 'chain_id', ok: true },
    { name: 'gas_price', ok: false },
    { name: 'block_number', ok: true },
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failed_checks, ['gas_price']);
  assert.equal(report.checks.length, 3);
  assert.ok(report.generated_at);
});

function scriptedFetch(results) {
  return async (_url, { body }) => {
    const { method } = JSON.parse(body);
    const value = results[method];
    if (value instanceof Error) throw value;
    return { ok: true, json: async () => ({ result: value }) };
  };
}

test('pingChain reports all three checks from a scripted RPC', async () => {
  const results = await pingChain(
    'https://example.invalid/api',
    scriptedFetch({
      eth_chainId: '0xf22f',
      eth_gasPrice: '0x0',
      eth_blockNumber: '0x1234',
    }),
  );
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].reported, 61999);
  assert.equal(results[1].is_zero, true);
  assert.equal(results[2].block, 0x1234);
});

test('pingChain records a failed check instead of throwing', async () => {
  const results = await pingChain(
    'https://example.invalid/api',
    scriptedFetch({
      eth_chainId: new Error('unreachable'),
      eth_gasPrice: '0x0',
      eth_blockNumber: '0x1',
    }),
  );
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /unreachable/);
  assert.equal(results[1].ok, true);
});
