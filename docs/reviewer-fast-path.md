# Deployment and validation

The revised contract is deployed at `0x04109e0EA19e022Abdeb51BA907AF468aCEe1Da1`.
Its FINALIZED/SUCCESS receipt and matching-source readback are under
`evidence/revision-4/`; complete live flow acceptance is still pending. `evidence/deployment.json`,
`deploy-receipt.json`, `flow*.json`, `evidence.json` and `verification.json`
are preserved historical records for `0xa926EFede20F0D4Daaa29cfba42a3C57f8c2acd3`.
Their source hash is not the revised source hash. `verify.mjs` will correctly
report that mismatch if used against the revised working tree.

## Read-only preparation

Run `npm test`, `npm run test-frontend`, `npm run build-site` and
`node scripts/deploy.mjs --dry-validate`. The last command verifies chain 61999
and requests a schema without generating or signing a deployment transaction.
The schema response is retained in `evidence/local-validation/schema.json`.
Schema generation is not proof of nondeterministic runtime execution.

## New deployment acceptance

For any future source change, deploy again and retain a new
FINALIZED/SUCCESS receipt and matching code hash. Preserve historical
receipts in place and use distinct filenames for new evidence. Update frontend
contract/explorer links and set `REMEDIATED_DEPLOYMENT` true only after matching
the new source to that address. Rebuild before publishing.

For a new bounty, fund issuer and hunter accounts using the documented Studionet
faucet; publish the exact claim token in the hunter's GitHub bio or as the
scoped identity file on an owned repository's default branch. Verify an attempted
claim by a different wallet is rejected with a refundable credit. Submit an
eligible merged PR with bounded changed code. Obtain a FINALIZED/SUCCESS
`evaluate_delivery` receipt and read back the manifest and pending verdict.
Attempt settlement inside the window and retain its expected failure receipt.
Challenge before expiry, verify settlement stays blocked, and resolve from an
unrelated wallet. After the new 24-hour window, settle from an unrelated wallet,
withdraw using the actual payee and read back credits, reputation and conservation.
Repeat for tier payouts, identity mismatch, unavailable/oversized code and
injected-versus-temporary signing. Never advance production timestamps to
simulate waiting, or label local fixture tests as chain verification.


## Revised-version transaction runner

`BB_RECOVERY_FILE=/absolute/private.json node scripts/acceptance.mjs` accepts
`deploy`, `status`, `fund`, `call <request.json>` or `read`. The recovery file
must live outside this repository and contain the account keys. Expected hashes
are persisted before broadcast; duplicate request labels cannot be submitted.
`status` records final receipts without resubmission. `read` checks the deployed
code hash and reads finalized bounties and ledger totals. Do not publish recovery
files or copy private keys into evidence.
