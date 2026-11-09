// Reputation export (JSON): read FINALIZED get_hunter readbacks for the
// given addresses and write them to a JSON file.
// Usage: node scripts/export_reputation.mjs <contract-address> <out.json> <address...>
// Reads only; never sends a transaction.
import fs from 'node:fs';
import { readJson } from './network.mjs';

export function formatReputationJson(hunters) {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      hunters: hunters.map((h) => ({
        address: h.address,
        reputation: h.reputation,
        settled: h.settled,
        accepted: h.accepted,
        partial: h.partial,
        rejected: h.rejected,
        fake: h.fake,
      })),
    },
    null,
    2,
  ) + '\n';
}

export function rankHunters(hunters) {
  return [...hunters].sort(
    (a, b) => b.reputation - a.reputation || b.settled - a.settled,
  );
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invoked) {
  const [contract, out, ...addresses] = process.argv.slice(2);
  if (!contract || !out || addresses.length === 0) {
    console.error('usage: node scripts/export_reputation.mjs <contract-address> <out.json> <address...>');
    process.exit(1);
  }
  const hunters = [];
  for (const address of addresses) {
    hunters.push(await readJson(contract, 'get_hunter', [address.toLowerCase()]));
  }
  fs.writeFileSync(out, formatReputationJson(rankHunters(hunters)));
  console.log(`exported ${hunters.length} hunter(s) to ${out}`);
}
