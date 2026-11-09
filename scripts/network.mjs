// Shared chain access for Bounty Board v2 (Stable Studionet only).
// Reads and receipt polling retry on transient RPC failures (the RPC
// sometimes answers with an HTML error page instead of JSON). A write
// submission is NEVER retried here: if eth_sendRawTransaction fails the
// caller must check whether the transaction landed before doing anything.
import { createClient, abi } from 'genlayer-js';
import { encodeFunctionData, getAddress } from 'viem';
import { studionet } from 'genlayer-js/chains';

export const RPC = 'https://studio.genlayer.com/api';
export const CHAIN_ID = 61999;
export const WEI_PER_UNIT = 10n ** 15n;
export const GEN = 10n ** 18n;

export const chain = { ...studionet, rpcUrls: { default: { http: [RPC] } } };
export const reader = createClient({ chain, endpoint: RPC });
const { calldata, transactions } = abi;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function rpc(method, params = []) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let res;
    try {
      res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (method === 'eth_sendRawTransaction') {
        error.broadcast_uncertain = true;
        throw error;
      }
      await sleep(Math.min(15000 * (attempt + 1), 60000));
      continue;
    }
    if (res.status === 429) {
      const seconds = Math.max(15, Number(res.headers.get('retry-after') || 60) + 1);
      console.warn(`RPC rate limit for ${method}; waiting ${seconds}s.`);
      await sleep(Math.min(seconds, 3600) * 1000);
      attempt -= 1;
      continue;
    }
    if ([408, 502, 503, 504].includes(res.status) && method !== 'eth_sendRawTransaction') {
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    if (!res.ok) {
      const error = Error(`RPC_HTTP_${res.status}`);
      if (method === 'eth_sendRawTransaction') error.broadcast_uncertain = true;
      throw error;
    }
    let body;
    try {
      body = await res.json();
    } catch {
      // HTML error page instead of JSON: transient, retry on reads.
      if (method === 'eth_sendRawTransaction') throw Error('RPC_NON_JSON_RESPONSE');
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    if (body.error) {
      if (body.error.code === -32029) {
        const seconds = Math.max(15, Number(body.error.data?.retry_after_seconds || 60) + 1);
        console.warn(`RPC quota for ${method}; waiting ${seconds}s.`);
        await sleep(Math.min(seconds, 3600) * 1000);
        attempt -= 1;
        continue;
      }
      throw Error(JSON.stringify(body.error));
    }
    return body.result;
  }
  throw Error('RPC_RETRY_EXHAUSTED');
}

export async function validateChain(request = rpc) {
  const id = await request('eth_chainId');
  if (Number(BigInt(id)) !== CHAIN_ID) throw Error('WRONG_CHAIN');
  return id;
}

export function encoded(method, args = []) {
  return transactions.serialize([calldata.encode(calldata.makeCalldataObject(method, args, {})), false]);
}

export function envelope(sender, to, data) {
  const entry = chain.consensusMainContract.abi.find(
    (x) => x.type === 'function' && x.name === 'addTransaction');
  const args = [sender, to, 5, 3, data];
  if (entry.inputs.length === 6) args.push(BigInt(Math.floor(Date.now() / 1000) + 3600));
  return encodeFunctionData({ abi: [entry], functionName: 'addTransaction', args });
}

export async function sendLocal(account, to, data, value = 0n) {
  await validateChain();
  const nonce = await rpc('eth_getTransactionCount', [account.address, 'latest']);
  const serialized = await account.signTransaction({
    chainId: CHAIN_ID,
    type: 'legacy',
    to: chain.consensusMainContract.address,
    data: envelope(account.address, to, data),
    nonce: Number(BigInt(nonce)),
    gas: 20000000n,
    gasPrice: 0n,
    value: BigInt(value),
  });
  return rpc('eth_sendRawTransaction', [serialized]);
}

export async function fundAccount(address, amountWei) {
  const checksummed = getAddress(address);
  return rpc('sim_fundAccount', [checksummed, Number(amountWei)]);
}

export async function fundAndWait(account, amountWei) {
  await fundAccount(account.address, amountWei);
  // The faucet amount travels as a JSON double, so the credited balance
  // can sit a few wei below the requested amount; allow 1% slack.
  const minWei = BigInt(amountWei) - BigInt(amountWei) / 100n;
  for (let i = 0; i < 30; i++) {
    const bal = BigInt(await rpc('eth_getBalance', [account.address, 'latest']));
    if (bal >= minWei) return bal;
    await sleep(2000);
  }
  throw Error('FAUCET_FUND_TIMEOUT');
}

export async function contractBalance(address) {
  return rpc('eth_getBalance', [address, 'latest']);
}

// Read a view method from the latest FINALIZED state. Retries on
// transient RPC failures; throws on a contract-level error.
export async function readFinal(address, functionName = 'get_ledger_totals', args = []) {
  const result = await rpc('gen_call', [{
    type: 'read',
    to: address,
    from: '0x0000000000000000000000000000000000000000',
    data: encoded(functionName, args),
    transaction_hash_variant: 'latest-final',
  }]);
  if (result && typeof result === 'object' && result.status && result.status.code !== 0) {
    throw Error(result.status.message);
  }
  const hex = typeof result === 'string' ? result : result?.data;
  if (typeof hex !== 'string') throw Error('INVALID_READ_RESULT');
  const plain = hex.startsWith('0x') ? hex.slice(2) : hex;
  return calldata.decode(Uint8Array.from(plain.match(/../g) || [], (x) => parseInt(x, 16)));
}

export async function readJson(address, functionName, args = []) {
  return JSON.parse(await readFinal(address, functionName, args));
}

// Wait until a transaction reaches FINALIZED (or the timeout expires).
// Returns the receipt, or null on timeout. Never resubmits.
export async function waitFinalized(hash, { timeoutMs = 15 * 60 * 1000, intervalMs = 6000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc('eth_getTransactionByHash', [hash]);
    if (receipt?.status === 'FINALIZED') return receipt;
    await sleep(intervalMs);
  }
  return null;
}

export function receiptSummary(receipt) {
  const leaders = receipt?.consensus_data?.leader_receipt;
  const leader = Array.isArray(leaders)
    ? leaders.find((x) => x.mode === 'leader') || leaders[0]
    : leaders;
  return {
    hash: receipt?.hash,
    status: receipt?.status,
    result_name: receipt?.result_name,
    leader_execution: leader?.execution_result,
    to_address: receipt?.to_address,
  };
}
