// Deploy contracts/bounty_board.py to Stable Studionet.
// Usage: node scripts/deploy.mjs [--dry-validate]
// Writes evidence/deployment.json and evidence/deploy-receipt.json.
// The deployer account is generated in process memory only; its key is
// never written to disk. If this process dies, redeploy from scratch.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createAccount, abi } from 'genlayer-js';
import {
  reader, rpc, validateChain, sendLocal, readFinal,
  waitFinalized, receiptSummary,
} from './network.mjs';

const code = fs.readFileSync('contracts/bounty_board.py', 'utf8');
await validateChain();
let wrongRejected = false;
try {
  await validateChain(async () => '0x1');
} catch (e) {
  wrongRejected = e.message === 'WRONG_CHAIN';
}
if (!wrongRejected) throw Error('WRONG_CHAIN_CHECK_FAILED');
const schema = await reader.getContractSchemaForCode(code);
if (schema?.error) throw Error(JSON.stringify(schema));
const sourceSha = createHash('sha256').update(code).digest('hex');
console.log(JSON.stringify({
  mode: 'dry-validate', chain: 61999, source_sha256: sourceSha,
  wrong_chain_rejected: wrongRejected, schema,
}));
if (!process.argv.includes('--dry-validate')) {
  const account = createAccount();
  const data = abi.transactions.serialize([
    new TextEncoder().encode(code),
    abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, [], {})),
    false,
  ]);
  const hash = await sendLocal(account, '0x0000000000000000000000000000000000000000', data);
  console.log(JSON.stringify({ deploy_tx: hash, deployer: account.address }));
  const record = {
    network: 'Stable Studionet',
    chain_id: 61999,
    rpc: 'https://studio.genlayer.com/api',
    explorer: '',
    studio: '',
    contractAddress: '',
    deployTxHash: hash,
    deployer: account.address,
    contractFile: 'contracts/bounty_board.py',
    contractSha256: sourceSha,
    deployedCodeSha256: '',
    deployedCodeMatchesSource: false,
    deployedAt: new Date().toISOString(),
    receiptStatus: 'PENDING',
  };
  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync('evidence/deployment.json', JSON.stringify(record, null, 2) + '\n');
  const receipt = await waitFinalized(hash, { timeoutMs: 15 * 60 * 1000 });
  fs.writeFileSync('evidence/deploy-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
  if (!receipt || receipt.status !== 'FINALIZED') throw Error('DEPLOYMENT_NOT_FINALIZED');
  const leaders = receipt.consensus_data?.leader_receipt;
  const leader = Array.isArray(leaders)
    ? leaders.find((x) => x.mode === 'leader') || leaders[0]
    : leaders;
  if (receipt.result_name !== 'MAJORITY_AGREE' || leader?.execution_result !== 'SUCCESS' ||
      !receipt.to_address || receipt.to_address === '0x0000000000000000000000000000000000000000') {
    throw Error('DEPLOYMENT_EXECUTION_FAILED: ' + JSON.stringify(receiptSummary(receipt)));
  }
  record.contractAddress = receipt.to_address;
  record.explorer = `https://explorer-studio.genlayer.com/address/${receipt.to_address}`;
  record.studio = `https://studio.genlayer.com/?import-contract=${receipt.to_address}`;
  record.receiptStatus = 'FINALIZED';
  // Verify the deployed code matches the source bytes (best effort: the
  // code-read RPC may not be exposed on this endpoint). The RPC returns
  // the source base64-encoded; decode before hashing.
  try {
    const deployed = await rpc('gen_getContractCode', [receipt.to_address]);
    const deployedCode = typeof deployed === 'string'
      ? deployed
      : deployed?.code || deployed?.data || '';
    if (typeof deployedCode === 'string' && deployedCode.length > 0) {
      let decoded = deployedCode;
      try {
        const buf = Buffer.from(deployedCode, 'base64');
        if (buf.toString('base64').replace(/=+$/, '') ===
            deployedCode.replace(/=+$/, '')) decoded = buf.toString('utf8');
      } catch { /* not base64; use as-is */ }
      const deployedSha = createHash('sha256').update(decoded).digest('hex');
      record.deployedCodeSha256 = deployedSha;
      record.deployedCodeMatchesSource = deployedSha === sourceSha;
    }
  } catch (error) {
    record.deployedCodeMatchesSource = null;
    record.deployedCodeNote = `code-read RPC unavailable: ${error.message}`;
  }
  fs.writeFileSync('evidence/deployment.json', JSON.stringify(record, null, 2) + '\n');
  const totals = await readFinal(record.contractAddress, 'get_ledger_totals', []);
  fs.writeFileSync('evidence/deploy-read-back.json',
    typeof totals === 'string' ? totals : JSON.stringify(totals));
  console.log(JSON.stringify({
    contract: record.contractAddress, status: 'FINALIZED', execution: 'SUCCESS',
    code_matches_source: record.deployedCodeMatchesSource, read_back: totals,
  }));
}
