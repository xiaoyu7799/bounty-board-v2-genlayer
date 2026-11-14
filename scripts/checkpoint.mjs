// Checkpoint / resume for the historical Bounty Board evidence flow.
//
// Temporary test-account keys are checkpointed outside the repository so
// interrupted evidence runs can resume. Storage rules:
//   - checkpoint lives at <workdir>/checkpoint.json — OUTSIDE repo/, never
//     committed, never in any delivery doc, never copied anywhere else.
//   - file is 0600, written atomically (tmp file + rename).
//   - it is deleted as soon as the flow finishes (DONE + evidence written)
//     or is explicitly abandoned. A completed run leaves no checkpoint.
//   - it holds no salt: this flow uses no salts (accounts are bare keys).
//
// Resume rule (flow.mjs startup): load the checkpoint, verify it against
// the chain (LATEST_FINAL readback + every recorded tx receipt), and only
// then continue from the first unfinished step. If the checkpoint's
// contract differs from evidence/deployment.json, or any check fails, the
// checkpoint is discarded and the run starts fresh.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKPOINT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'checkpoint.json',
);
export const CHECKPOINT_VERSION = 1;

export function checkpointExists(cpPath = CHECKPOINT_PATH) {
  return fs.existsSync(cpPath);
}

// Atomic write with 0600 permissions: tmp file in the same directory,
// chmod, then rename (rename is atomic on the same filesystem).
export function writeCheckpoint(data, cpPath = CHECKPOINT_PATH) {
  const payload = { ...data, version: CHECKPOINT_VERSION, updated_at: new Date().toISOString() };
  const tmp = `${cpPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, cpPath);
  fs.chmodSync(cpPath, 0o600);
  return cpPath;
}

export function readCheckpoint(cpPath = CHECKPOINT_PATH) {
  if (!fs.existsSync(cpPath)) return null;
  const data = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
  if (data.version !== CHECKPOINT_VERSION) throw Error(`CHECKPOINT_VERSION_MISMATCH:${data.version}`);
  if (typeof data.contract !== 'string' || !data.accounts?.issuer?.privateKey) {
    throw Error('CHECKPOINT_MALFORMED');
  }
  return data;
}

// Returns true if a file was removed.
export function deleteCheckpoint(cpPath = CHECKPOINT_PATH) {
  if (!fs.existsSync(cpPath)) return false;
  fs.unlinkSync(cpPath);
  return true;
}

// Verify a checkpoint against live chain state before trusting it.
//   expectedContract: the contract in evidence/deployment.json.
//   readJson / rpc: the live-chain helpers from network.mjs.
// Returns { ok: true } or { ok: false, reason }.
// Checks, in order: contract match, contract readable (not abandoned),
// every recorded tx FINALIZED, every recorded case's on-chain status /
// settlement matches the checkpoint. A case that only ever recorded a
// rejected post (bb-0006) is expected to have NO bounty on-chain.
export async function verifyCheckpoint(cp, { expectedContract, readJson, rpc }) {
  if (cp.contract !== expectedContract) {
    return { ok: false, reason: `CONTRACT_MISMATCH:checkpoint=${cp.contract}:deployment=${expectedContract}` };
  }
  try {
    await readJson(cp.contract, 'get_ledger_totals', []);
  } catch (e) {
    return { ok: false, reason: `CONTRACT_UNREADABLE:${String(e.message || e).slice(0, 120)}` };
  }
  for (const tx of cp.transactions || []) {
    let receipt = null;
    try {
      receipt = await rpc('eth_getTransactionByHash', [tx.hash]);
    } catch (e) {
      return { ok: false, reason: `TX_RECEIPT_UNREADABLE:${tx.hash}` };
    }
    if (!receipt || receipt.status !== 'FINALIZED') {
      return { ok: false, reason: `TX_NOT_FINALIZED:${tx.hash}` };
    }
  }
  for (const [bountyId, c] of Object.entries(cp.cases || {})) {
    const steps = c.steps || {};
    const expectedAbsent = Boolean(steps.rejected_post && !steps.post);
    let bounty = null;
    let readFailed = false;
    try {
      bounty = await readJson(cp.contract, 'get_bounty', [bountyId]);
    } catch {
      readFailed = true;
    }
    if (expectedAbsent) {
      if (!readFailed) return { ok: false, reason: `CASE_SHOULD_NOT_EXIST:${bountyId}` };
      continue;
    }
    if (readFailed) {
      if (Object.keys(steps).length === 0) continue; // case never reached the chain
      return { ok: false, reason: `CASE_MISSING_ON_CHAIN:${bountyId}` };
    }
    const expectedStatus = c.status || c.readback?.status;
    if (expectedStatus && bounty.status !== expectedStatus) {
      return { ok: false, reason: `CASE_STATUS_MISMATCH:${bountyId}:checkpoint=${expectedStatus}:chain=${bounty.status}` };
    }
    if (c.settlement && bounty.settlement) {
      const a = c.settlement;
      const b = bounty.settlement;
      if (a.hunter_payout_units !== undefined && b.hunter_payout_units !== undefined &&
          String(a.hunter_payout_units) !== String(b.hunter_payout_units)) {
        return { ok: false, reason: `CASE_SETTLEMENT_MISMATCH:${bountyId}:hunter_payout` };
      }
      if (a.issuer_refund_units !== undefined && b.issuer_refund_units !== undefined &&
          String(a.issuer_refund_units) !== String(b.issuer_refund_units)) {
        return { ok: false, reason: `CASE_SETTLEMENT_MISMATCH:${bountyId}:issuer_refund` };
      }
    }
  }
  return { ok: true };
}
