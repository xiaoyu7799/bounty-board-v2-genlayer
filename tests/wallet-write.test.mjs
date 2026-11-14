import test from 'node:test';
import assert from 'node:assert/strict';
import { writeAsDisplayed, fundTemporary, genToUnits } from '../site/src/wallet-write.js';
const address = '0x' + '22'.repeat(20);
const other = '0x' + '33'.repeat(20);
function setup(kind = 'temp') {
  const calls = [];
  const wallet = { kind, address, provider: { request: async (x) => {
    calls.push(x); return x.method === 'eth_chainId' ? '0xf22f' : x.method === 'eth_accounts' ? [address] : '0xhash';
  } } };
  const args = { wallet, currentWallet: () => wallet, chainId: 61999, to: other, data: '0x1234', value: 1n,
    tempAccount: { address, signTransaction: async (tx) => { calls.push(tx); return '0xsigned'; } },
    rpc: async (method, params) => { calls.push({ method, params }); return method === 'eth_chainId' ? '0xf22f' : method === 'eth_getBalance' ? '0x10' : method === 'eth_getTransactionCount' ? '0x0' : '0xhash'; } };
  return { args, calls };
}
test('injected displayed account signs even if a different temporary signer exists', async () => {
  const { args, calls } = setup('injected'); args.tempAccount.address = other;
  assert.equal(await writeAsDisplayed(args), '0xhash');
  assert.equal(calls.at(-1).method, 'eth_sendTransaction');
  assert.equal(calls.at(-1).params[0].from, address);
});
test('disconnect and account switches reject writes', async () => {
  const { args } = setup();
  await assert.rejects(writeAsDisplayed({ ...args, wallet: null }), /CONNECT/);
  await assert.rejects(writeAsDisplayed({ ...args, currentWallet: () => null }), /DISPLAY_ACCOUNT_CHANGED/);
  args.tempAccount.address = other;
  await assert.rejects(writeAsDisplayed(args), /SIGNER_MISMATCH/);
});
test('injected network and provider account changes reject before sending', async () => {
  for (const [network, accounts, error] of [['0x1', [address], /WRONG_CHAIN/], ['0xf22f', [other], /WALLET_ACCOUNT_CHANGED/]]) {
    const { args } = setup('injected');
    args.wallet.provider.request = async ({ method }) => method === 'eth_chainId' ? network : accounts;
    await assert.rejects(writeAsDisplayed(args), error);
  }
});
test('temporary funds and nonce use displayed signer; insufficient balance fails', async () => {
  const { args, calls } = setup();
  await writeAsDisplayed(args);
  assert.equal(calls.find(x => x.method === 'eth_getBalance').params[0], address);
  assert.equal(calls.find(x => x.method === 'eth_getTransactionCount').params[0], address);
  assert.equal(calls.at(-1).method, 'eth_sendRawTransaction');
  args.rpc = async (method) => method === 'eth_chainId' ? '0xf22f' : '0x0';
  await assert.rejects(writeAsDisplayed(args), /FUND_DISPLAYED/);
});
test('faucet funds only displayed temporary account and propagates failure', async () => {
  const { args, calls } = setup();
  await fundTemporary(args);
  assert.equal(calls[1].method, 'sim_fundAccount');
  assert.equal(calls[1].params[0], address);
  await assert.rejects(fundTemporary({ ...args, wallet: { kind: 'injected', address } }), /SELECT_TEMP/);
  await assert.rejects(fundTemporary({ ...args, rpc: async () => { throw Error('FAUCET_UNAVAILABLE'); } }), /FAUCET_UNAVAILABLE/);
});

test('GEN input converts to exact contract units with range and precision checks', () => {
  assert.equal(genToUnits('10'), 10000);
  assert.equal(genToUnits('1.001'), 1001);
  assert.equal(genToUnits('200'), 200000);
  for (const value of ['0', '0.999', '200.001', '1.0001', 'NaN', '1e2', '-1']) {
    assert.throws(() => genToUnits(value), /INVALID_GEN_AMOUNT/);
  }
});
