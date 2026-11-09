// Chain connectivity check: verify an RPC endpoint answers, reports the
// expected chain id, and can read a contract's ledger totals.
// Usage: node scripts/chain_ping.mjs [rpc-url] [contract-address]
// Prints a JSON report; exit 1 when the chain id is wrong or the RPC
// does not answer. Reads only; never sends a transaction.
import { RPC, CHAIN_ID, readJson } from './network.mjs';

export function checkChainId(chainIdHex, expected = CHAIN_ID) {
  const id = Number(BigInt(chainIdHex));
  return { reported: id, expected, ok: id === expected };
}

export function checkGasPrice(gasPriceHex) {
  const price = BigInt(gasPriceHex);
  return { wei: price.toString(), is_zero: price === 0n };
}

export function formatPingReport(results) {
  const failed = results.filter((r) => !r.ok);
  return {
    generated_at: new Date().toISOString(),
    rpc: results[0]?.rpc || '',
    ok: failed.length === 0,
    failed_checks: failed.map((r) => r.name),
    checks: results,
  };
}

export async function pingChain(rpcUrl = RPC, fetchFn = fetch) {
  const results = [];
  const post = async (method, params = []) => {
    const res = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`RPC_HTTP_${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(JSON.stringify(body.error));
    return body.result;
  };
  try {
    const chainId = await post('eth_chainId');
    const chain = checkChainId(chainId);
    results.push({ name: 'chain_id', rpc: rpcUrl, ok: chain.ok, ...chain });
  } catch (error) {
    results.push({ name: 'chain_id', rpc: rpcUrl, ok: false, error: error.message });
  }
  try {
    const gas = await post('eth_gasPrice');
    const gasCheck = checkGasPrice(gas);
    results.push({ name: 'gas_price', rpc: rpcUrl, ok: true, ...gasCheck });
  } catch (error) {
    results.push({ name: 'gas_price', rpc: rpcUrl, ok: false, error: error.message });
  }
  try {
    const block = await post('eth_blockNumber');
    results.push({ name: 'block_number', rpc: rpcUrl, ok: true, block: Number(BigInt(block)) });
  } catch (error) {
    results.push({ name: 'block_number', rpc: rpcUrl, ok: false, error: error.message });
  }
  return results;
}

export async function checkContractLedger(contractAddress) {
  const totals = await readJson(contractAddress, 'get_ledger_totals', []);
  const received = BigInt(totals.total_received_wei);
  const spent = BigInt(totals.total_withdrawn_wei) + BigInt(totals.withdrawable_wei) +
    BigInt(totals.escrowed_wei);
  return {
    name: 'contract_ledger',
    ok: received === spent && BigInt(totals.escrowed_wei) === BigInt(totals.escrowed_wei_recomputed),
    contract: contractAddress,
    totals,
  };
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invoked) {
  const rpcUrl = process.argv[2] || RPC;
  const contract = process.argv[3] || '';
  const results = await pingChain(rpcUrl);
  if (contract) {
    try {
      results.push(await checkContractLedger(contract));
    } catch (error) {
      results.push({ name: 'contract_ledger', ok: false, error: error.message });
    }
  }
  const report = formatPingReport(results);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
