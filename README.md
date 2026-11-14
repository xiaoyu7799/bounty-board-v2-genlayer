# Bounty Board

Website: https://xiaoyu7799.github.io/bounty-board-v2-genlayer/

A GitHub bounty market with real testnet GEN escrow, independent semantic
adjudication, challenges and pull payments on Stable Studionet (61999).

The revised source is deployed at `0x04109e0EA19e022Abdeb51BA907AF468aCEe1Da1`
with a FINALIZED/SUCCESS receipt and independently matched source hash.
See `evidence/revision-4/`. Revision 3 failed its negative identity test;
its failure and ledger discrepancy remain under `evidence/revision-3/`. Live identity, immutable-code consensus and permissionless challenge resolution
are verified. Final settlement evidence awaits the genuine 24-hour challenge expiry. The website serves the revised configuration with writes disabled until
the genuine deadline and final settlement acceptance.
Historical receipts in the root `evidence/` directory belong to
`0xa926EFede20F0D4Daaa29cfba42a3C57f8c2acd3` only.

## Work and payment

1. Post 1–200 testnet GEN, a target repository and fixed requirements.
2. Select the wallet that will receive payment. Before claiming, put the
   following whitespace-separated token in the GitHub profile bio:
   `bb:61999:<lowercase-contract-address>:<bounty-id>:<lowercase-wallet-address>`.
   Bind the identity without value using `bind_github_identity`, wait for
   FINALIZED/SUCCESS, then claim with the same GitHub login and exact stake (10%, clamped to 1–10 GEN).
   Alternatively, commit the exact token as the entire file
   `identity/<lowercase-wallet-address>/<bounty-id>.txt` in a repository owned
   by that GitHub login. Pass its repository slug and immutable commit SHA to
   `claim_bounty`; the commit must already be an ancestor of the repository's
   default branch. A fork-only or unmerged branch commit cannot authorize a claim.
   Validators verify the profile or repository proof independently during binding.
   Payable `claim_bounty` reads the confirmed binding only and makes no external calls.
   The verified numeric GitHub ID
   and login are bound to the claimant wallet; a matching name alone is insufficient.
3. Submit a merged PR in the target repository. Its author must match that
   identity, a commit must mention the bounty ID, and at least two code files
   with 100 changed lines must exist at the verified merge SHA.
4. Anyone can trigger evaluation. Validators fetch full bounded code files
   at that SHA and independently score completeness, scope and quality.
   File SHA-256 digests enter the evidence hash and must agree exactly;
   scores tolerate ±10 but the payout tier must match exactly. Delivery
   notes are unverified claims, never a substitute for code.
5. Each verdict starts a 24-hour challenge window. The hunter may challenge
   at most twice. Any account may resolve a pending challenge; resolution
   starts a fresh 24-hour window. An unresolved challenge blocks settlement.
   Once the window ends and no challenge is pending, anyone may settle.
6. Withdraw credits from the original claimant or issuer wallet. The account
   triggering settlement cannot redirect payment.

| Tier | Hunter bounty share | Stake | Reputation |
|---|---:|---|---:|
| ACCEPT (≥80 / ≥80 / ≥70) | 100% | returned | +5 |
| PARTIAL (≥50 / ≥50) | 60% | returned | +2 |
| REJECT | 0% | returned | −2 |
| FAKE (proven gate failure) | 0% | paid to issuer | −10 |

Incomplete or unavailable code evidence aborts evaluation without changing
state or assigning a tier. Invalid payable claims credit sent funds back
for withdrawal instead of stranding them.

## Browser accounts and funding

Injected wallets sign using the same account displayed in the UI, with
`eth_accounts` and chain checks before submission. Provider account/network
changes disconnect the UI. Selecting a temporary account uses that account
for display, authorization, nonce, balance and signing. The **Fund displayed
account** button calls the existing Studionet `sim_fundAccount` faucet for
20 testnet GEN and displays its balance. Funding availability is a network
service dependency; insufficient balance blocks payable temporary writes.
The amount input is GEN and is converted exactly to 0.001-GEN contract units.
Temporary keys live only in memory: closing the page loses control of any
remaining funds. Use a persistent injected wallet for continuing work.

## Reproduce

```sh
npm ci --ignore-scripts
npm test
npm run test-frontend
npm run build-site
node scripts/deploy.mjs --dry-validate
```

Python tests use scripted GitHub responses, model scores, identity proofs
and transaction time. JavaScript tests cover signing, faucet routing and
existing readback/export behavior. Neither is live consensus evidence.
Dry validation asks the Stable Studionet RPC to derive the contract schema;
it does not deploy or send a transaction.

See [mechanism](docs/mechanism.md), [limits](KNOWN_LIMITATIONS.md),
[validation](docs/validation.md) and [deployment checks](docs/reviewer-fast-path.md).
Historical receipts, failures and readbacks remain in `evidence/` unchanged.
The old `flow.mjs` and `fix-repo-mismatch.mjs` scripts are historical-version
flows and refuse a source/deployment mismatch before contacting the chain.
