// Reputation export (JSON): read FINALIZED get_hunter readbacks for the
// given addresses and write them to a JSON file.
// Usage: node scripts/export_reputation.mjs <contract-address> <out.json> [--top N] [--compact] <address...>
// Reads only; never sends a transaction.
import fs from 'node:fs';
import { readJson } from './network.mjs';

export function formatReputationJson(hunters, options = {}) {
  const ranked = rankHunters(hunters);
  const top = options.top && options.top > 0 ? ranked.slice(0, options.top) : ranked;
  const payload = {
    exported_at: new Date().toISOString(),
    hunters: top.map((h) => ({
      address: h.address,
      reputation: h.reputation,
      settled: h.settled,
      accepted: h.accepted,
      partial: h.partial,
      rejected: h.rejected,
      fake: h.fake,
    })),
    summary: summarizeHunters(ranked),
  };
  return options.compact
    ? JSON.stringify(payload) + '\n'
    : JSON.stringify(payload, null, 2) + '\n';
}

export function rankHunters(hunters) {
  return [...hunters].sort(
    (a, b) => b.reputation - a.reputation || b.settled - a.settled,
  );
}

// Summary statistics over the ranked list: totals, averages, and the
// tier mix. Pure function of the readback records.
export function summarizeHunters(hunters) {
  const total = hunters.length;
  const reputationTotal = hunters.reduce((n, h) => n + h.reputation, 0);
  const settledTotal = hunters.reduce((n, h) => n + h.settled, 0);
  const tiers = {
    accepted: hunters.reduce((n, h) => n + h.accepted, 0),
    partial: hunters.reduce((n, h) => n + h.partial, 0),
    rejected: hunters.reduce((n, h) => n + h.rejected, 0),
    fake: hunters.reduce((n, h) => n + h.fake, 0),
  };
  const topReputation = total > 0 ? hunters[0].reputation : 0;
  const flagged = hunters.filter((h) => h.fake > 0).map((h) => h.address);
  return {
    hunters: total,
    reputation_total: reputationTotal,
    reputation_average: total > 0 ? reputationTotal / total : 0,
    settled_total: settledTotal,
    tiers,
    top_reputation: topReputation,
    hunters_with_fake_verdicts: flagged,
  };
}

export function parseExportArgs(argv) {
  const args = { top: 0, compact: false, positional: [] };
  for (const token of argv) {
    if (token === '--compact') {
      args.compact = true;
    } else if (token === '--top') {
      args.expectTop = true;
    } else if (args.expectTop) {
      const n = Number.parseInt(token, 10);
      if (!Number.isInteger(n) || n <= 0) throw new Error('INVALID_TOP');
      args.top = n;
      args.expectTop = false;
    } else {
      args.positional.push(token);
    }
  }
  if (args.expectTop) throw new Error('MISSING_TOP_VALUE');
  return args;
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invoked) {
  const parsed = parseExportArgs(process.argv.slice(2));
  const [contract, out, ...addresses] = parsed.positional;
  if (!contract || !out || addresses.length === 0) {
    console.error('usage: node scripts/export_reputation.mjs <contract-address> <out.json> [--top N] [--compact] <address...>');
    process.exit(1);
  }
  const hunters = [];
  for (const address of addresses) {
    hunters.push(await readJson(contract, 'get_hunter', [address.toLowerCase()]));
  }
  fs.writeFileSync(out, formatReputationJson(hunters, { top: parsed.top, compact: parsed.compact }));
  console.log(`exported ${hunters.length} hunter(s) to ${out}`);
}
