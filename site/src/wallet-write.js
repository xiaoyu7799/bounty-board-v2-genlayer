import { getAddress } from 'viem';
// One captured display account is used for preflight, authorization and signing.
export async function writeAsDisplayed({ wallet, tempAccount, rpc, chainId, to, data, value = 0n, currentWallet }) {
  if (!wallet?.address) throw Error('CONNECT_WALLET');
  const address = wallet.address.toLowerCase();
  const stillSelected = () => {
    if (currentWallet() !== wallet) throw Error('DISPLAY_ACCOUNT_CHANGED');
  };
  if (wallet.kind === 'injected') {
    const provider = wallet.provider;
    const network = await provider.request({ method: 'eth_chainId' });
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (Number(BigInt(network)) !== chainId) throw Error('WRONG_CHAIN');
    if (accounts[0]?.toLowerCase() !== address) throw Error('WALLET_ACCOUNT_CHANGED');
    stillSelected();
    return provider.request({ method: 'eth_sendTransaction', params: [{
      from: address, to, data, value: `0x${BigInt(value).toString(16)}`,
      gas: '0x1312d00', gasPrice: '0x0',
    }] });
  }
  if (wallet.kind !== 'temp' || tempAccount?.address.toLowerCase() !== address) throw Error('SIGNER_MISMATCH');
  if (Number(BigInt(await rpc('eth_chainId', []))) !== chainId) throw Error('WRONG_CHAIN');
  const balance = BigInt(await rpc('eth_getBalance', [address, 'latest']));
  if (balance < BigInt(value)) throw Error('FUND_DISPLAYED_TEMP_ACCOUNT_FIRST');
  const nonce = await rpc('eth_getTransactionCount', [address, 'latest']);
  stillSelected();
  const serialized = await tempAccount.signTransaction({ chainId, type: 'legacy', to, data,
    nonce: Number(BigInt(nonce)), gas: 20000000n, gasPrice: 0n, value: BigInt(value) });
  stillSelected();
  return rpc('eth_sendRawTransaction', [serialized]);
}

export async function fundTemporary({ wallet, rpc, currentWallet }) {
  if (wallet?.kind !== 'temp') throw Error('SELECT_TEMP_ACCOUNT');
  const address = getAddress(wallet.address);
  if (Number(BigInt(await rpc('eth_chainId', []))) !== 61999) throw Error('WRONG_CHAIN');
  if (currentWallet() !== wallet) throw Error('DISPLAY_ACCOUNT_CHANGED');
  await rpc('sim_fundAccount', [address, Number(20n * 10n ** 18n)]);
  return { address, balance: await rpc('eth_getBalance', [address, 'latest']) };
}

export { genToUnits } from './amounts.js';

export async function bindThenClaim({ wallet, currentWallet, runWrite, args, value }) {
  const bound = await runWrite('Bind GitHub identity', 'bind_github_identity', args, 0n);
  if (!bound) return null;
  if (currentWallet() !== wallet) throw Error('DISPLAY_ACCOUNT_CHANGED');
  return runWrite('Claim bounty', 'claim_bounty', args, value);
}
