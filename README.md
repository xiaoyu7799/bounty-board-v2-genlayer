# Bounty Board

Website: https://xiaoyu7799.github.io/bounty-board-v2-genlayer/

Post a bounty, deliver with a GitHub pull request, let consensus judge the
delivery, and release the escrow by tier. Built on GenLayer Stable
Studionet (Chain ID 61999). Real testnet GEN only.

## How it works

1. **Post** — the issuer locks a bounty (1–200 GEN) and names the target
   repository and the requirements.
2. **Claim** — a hunter locks a stake (`clamp(bounty / 10, 1 GEN, 10 GEN)`)
   and registers their GitHub login. One active claim at a time; a hunter
   cannot claim their own bounty. The issuer may set a minimum reputation.
3. **Deliver** — the hunter submits a pull request URL plus a delivery note.
4. **Evaluate** — the issuer triggers adjudication. Validators first run a
   deterministic gate over the GitHub API, then score semantics:
   - the PR is in the target repository locked at posting time;
   - the PR is merged, with a 40-hex merge commit;
   - the PR author is the registered hunter;
   - at least one commit message contains the bounty ID;
   - at least 2 code files changed, at least 100 changed lines;
   - every changed file exists in the merged repository tree.
   
   Any gate failure is a **FAKE** verdict. Only if every gate passes does
   an LLM score completeness / scope fit / quality (0–100 each).
5. **Settle** — money and reputation follow the verdict tier only:
   | Tier | Bounty | Stake | Reputation |
   |---|---|---|---|
   | ACCEPT (≥80 / ≥80 / ≥70) | 100% to hunter | back to hunter | +5 |
   | PARTIAL (≥50 / ≥50) | 60% hunter, 40% issuer | back to hunter | +2 |
   | REJECT (<50) | 100% back to issuer | back to hunter | −2 |
   | FAKE (gate failed) | 100% back to issuer | slashed to issuer | −10 |
6. **Challenge** — the hunter can challenge a pending verdict (up to 2
   times) with a new PR URL and a reason. The challenge re-runs the full
   adjudication against the new evidence; execution is locked while a
   challenge is pending. Either party may execute an unchallenged verdict.
7. **Withdraw** — all payouts are pull payments (`withdraw()`).

Reputation persists across bounties and gates future claims. Every
non-terminal state has an exit: open bounties can be cancelled, claims can
be abandoned or released, deliveries can be withdrawn, pending verdicts can
be challenged or executed. A failed payable call never takes money: it is
rejected and the full value is credited back to the sender.

## Contract

- Network: Stable Studionet, Chain ID 61999, RPC https://studio.genlayer.com/api
- Contract: `0x5991919D85E320F7dBaf85374267F6a4065B0172`
- Source: `contracts/bounty_board.py`
- Source SHA-256: `f7f6a84f66c69aaa3e77ffde8fbd9f60b667a689baee3c2e746e9ba31a061964`
  (matches the deployed code)
- Deploy transaction: `0x7d15c4a83cf349361892cd546cc5d838225949e4f5423cfd4457f1070db0b041`

See `evidence/deployment.json` for the deployment record,
`evidence/evidence.json` for every core transaction with FINALIZED
receipts and read-backs, and `docs/reviewer-fast-path.md` for the shortest
verification route.

## Use it

- Website: open the link above. No wallet is needed to read. Any injected
  EVM wallet (OKX, MetaMask, Rabby, Coinbase) can connect and read; writes
  use a clearly labelled temporary test account generated in the browser.
- Scripts: `npm install`, then `npm test` (contract mock tests),
  `node scripts/deploy.mjs` (deploy), `node scripts/flow.mjs` (evidence
  run), `node scripts/verify.mjs` (independent re-verification),
  `node scripts/build_site.mjs` (build the site).

## Known limitations

See `KNOWN_LIMITATIONS.md`.
