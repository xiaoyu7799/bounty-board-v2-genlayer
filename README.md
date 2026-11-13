# Bounty Board

Website: https://xiaoyu7799.github.io/bounty-board-v2-genlayer/

A GitHub bounty market with real testnet GEN escrow, independent semantic
adjudication, challenges and pull payments on Stable Studionet (61999).

The revised source requires a **new deployment**. The website configuration
still points to historical contract `0xa926EFede20F0D4Daaa29cfba42a3C57f8c2acd3`;
this branch blocks browser writes until a verified revised deployment is configured.
Existing receipts prove the historical version only.

## Work and payment

1. Post 1–200 testnet GEN, a target repository and fixed requirements.
2. Select the wallet that will receive payment. Before claiming, put the
   following whitespace-separated token in the GitHub profile bio:
   `bb:61999:<lowercase-contract-address>:<bounty-id>:<lowercase-wallet-address>`.
   Claim with the GitHub login and exact stake (10%, clamped to 1–10 GEN).
   Validators fetch the profile independently. The verified numeric GitHub ID
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
