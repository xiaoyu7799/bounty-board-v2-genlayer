// Revised-version Studionet acceptance. Recovery keys remain outside the repository.
// BB_RECOVERY_FILE=/absolute/private.json node scripts/acceptance.mjs deploy|status|fund|call|read
// call additionally takes an absolute JSON request path: {label,role,method,args,value_units}.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAccount, abi } from 'genlayer-js';
import { keccak256, getAddress } from 'viem';
import { chain, encoded, envelope, receiptSummary } from './network.mjs';

const checkpoint = process.env.BB_RECOVERY_FILE;
if (!checkpoint || !path.isAbsolute(checkpoint) || checkpoint.startsWith(path.resolve('.') + '/')) {
  throw Error('PRIVATE_RECOVERY_FILE_OUTSIDE_REPOSITORY_REQUIRED');
}
const lock = checkpoint + '.lock';
try { fs.mkdirSync(lock, { mode: 0o700 }); }
catch { throw Error('RECOVERY_FILE_IN_USE_OR_STALE_LOCK'); }
process.on('exit', () => { try { fs.rmdirSync(lock); } catch {} });
const state = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
const directory = 'evidence/revision-3';
fs.mkdirSync(directory, { recursive: true });
const save = () => {
  const temporary = checkpoint + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, checkpoint);
  fs.writeFileSync(directory + '/transactions.json', JSON.stringify({
    network: 'Stable Studionet', chain_id: 61999, contract: state.contract || '',
    accounts: Object.fromEntries(Object.entries(state.accounts).map(([role, account]) => [role, account.address])),
    transactions: state.transactions, updated_at: new Date().toISOString(),
  }, null, 2) + '\n');
};
async function rpc(method, params = []) {
  const response = await fetch('https://studio.genlayer.com/api', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw Error(`RPC_HTTP_${response.status}:${method}`);
  const body = await response.json();
  if (body.error) throw Error(JSON.stringify(body.error));
  return body.result;
}
if (Number(BigInt(await rpc('eth_chainId'))) !== 61999) throw Error('WRONG_CHAIN');
async function send(label, role, method, args, valueUnits, to, data) {
  if (state.transactions.some(tx => tx.label === label)) throw Error('LABEL_ALREADY_RECORDED_CHECK_STATUS');
  const account = createAccount(state.accounts[role].privateKey);
  const value = BigInt(valueUnits) * 10n ** 15n;
  const balance = BigInt(await rpc('eth_getBalance', [account.address, 'latest']));
  if (balance < value) throw Error('INSUFFICIENT_TESTNET_BALANCE');
  const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [account.address, 'latest'])));
  const raw = await account.signTransaction({ chainId: 61999, type: 'legacy',
    to: chain.consensusMainContract.address, data: envelope(account.address, to, data),
    nonce, gas: 20000000n, gasPrice: 0n, value });
  const hash = keccak256(raw);
  const tx = { label, role, method, args, value_units: valueUnits, hash, nonce,
    submitted_at: new Date().toISOString(), status: 'BROADCAST_PREPARED' };
  state.transactions.push(tx); save();
  // Persist the expected hash before broadcast. On uncertain response, inspect
  // this hash and nonce instead of automatically submitting another transaction.
  try {
    const returned = await rpc('eth_sendRawTransaction', [raw]);
    if (String(returned).toLowerCase() !== hash.toLowerCase()) throw Error('BROADCAST_HASH_MISMATCH');
    tx.status = 'BROADCAST'; save();
  } catch (error) { tx.broadcast_error = error.message; save(); throw error; }
  console.log(JSON.stringify({ label, hash }));
}
const command = process.argv[2];
if (command === 'deploy') {
  const code = fs.readFileSync('contracts/bounty_board.py', 'utf8');
  const sha = createHash('sha256').update(code).digest('hex');
  const schema = JSON.parse(fs.readFileSync('evidence/local-validation/schema.json'));
  if (schema.source_sha256 !== sha) throw Error('SCHEMA_SOURCE_MISMATCH');
  state.source_sha256 = sha; save();
  const data = abi.transactions.serialize([new TextEncoder().encode(code),
    abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, [], {})), false]);
  await send('deploy-r3', 'deployer', 'deploy', [], 0, '0x' + '00'.repeat(20), data);
} else if (command === 'status') {
  for (const tx of state.transactions.filter(tx => tx.status !== 'FINALIZED')) {
    const receipt = await rpc('eth_getTransactionByHash', [tx.hash]);
    if (!receipt) { console.log(JSON.stringify({ label: tx.label, status: 'NOT_OBSERVED' })); continue; }
    const summary = receiptSummary(receipt); tx.status = summary.status;
    tx.result_name = summary.result_name; tx.execution = summary.leader_execution;
    if (receipt.status === 'FINALIZED') {
      fs.writeFileSync(`${directory}/${tx.hash}.json`, JSON.stringify(receipt, null, 2) + '\n');
      if (tx.method === 'deploy' && summary.leader_execution === 'SUCCESS' && summary.result_name === 'MAJORITY_AGREE') {
        state.contract = receipt.to_address;
        fs.writeFileSync(directory + '/deployment.json', JSON.stringify({
          network: 'Stable Studionet', chain_id: 61999, contractAddress: state.contract,
          deployTxHash: tx.hash, contractSha256: state.source_sha256,
          receiptStatus: 'FINALIZED', execution: 'SUCCESS',
        }, null, 2) + '\n');
      }
    }
    save(); console.log(JSON.stringify({ label: tx.label, ...summary }));
  }
} else if (command === 'fund') {
  for (const role of ['issuer', 'hunter', 'stranger']) {
    const address = getAddress(state.accounts[role].address);
    const before = BigInt(await rpc('eth_getBalance', [address, 'latest']));
    if (before < 5n * 10n ** 18n) await rpc('sim_fundAccount', [address, Number(20n * 10n ** 18n)]);
    console.log(JSON.stringify({ role, address, balance: await rpc('eth_getBalance', [address, 'latest']) }));
  }
} else if (command === 'call') {
  if (!state.contract) throw Error('DEPLOYMENT_NOT_FINALIZED');
  const request = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  await send(request.label, request.role, request.method, request.args || [], request.value_units || 0,
    state.contract, encoded(request.method, request.args || []));
} else if (command === 'read') {
  if (!state.contract) throw Error('DEPLOYMENT_NOT_FINALIZED');
  const code = await rpc('gen_getContractCode', [state.contract]);
  const sha = createHash('sha256').update(Buffer.from(code, 'base64')).digest('hex');
  if (sha !== state.source_sha256) throw Error('DEPLOYED_SOURCE_MISMATCH');
  const snapshot = { contract: state.contract, source_sha256: sha, code_matches_source: true,
    read_at: new Date().toISOString() };
  for (const method of ['get_all_bounties', 'get_ledger_totals']) {
    const result = await rpc('gen_call', [{ type: 'read', to: state.contract,
      from: '0x' + '00'.repeat(20), data: encoded(method, []), transaction_hash_variant: 'latest-final' }]);
    const hex = typeof result === 'string' ? result : result?.data;
    if (typeof hex !== 'string') throw Error('INVALID_READBACK');
    snapshot[method] = JSON.parse(abi.calldata.decode(Buffer.from(hex.replace(/^0x/, ''), 'hex')));
  }
  state.snapshot = snapshot; save();
  fs.writeFileSync(directory + '/readback.json', JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify(snapshot));
} else throw Error('UNKNOWN_COMMAND');
