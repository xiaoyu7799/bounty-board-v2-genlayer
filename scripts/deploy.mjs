// Deploy contracts/bounty_board.py to Stable Studionet.
// Usage: node scripts/deploy.mjs [--dry-validate]
// New receipts go to evidence/revision-3; historical evidence is preserved.
// Deployment uses a private recovery file outside the repository.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  reader, validateChain,
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
  if (!process.env.BB_RECOVERY_FILE) throw Error('BB_RECOVERY_FILE_REQUIRED_FOR_DEPLOYMENT');
  process.argv[2] = 'deploy';
  await import('./acceptance.mjs');
}
