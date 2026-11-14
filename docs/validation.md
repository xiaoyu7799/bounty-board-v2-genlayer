# Validation of revised source

Base commit: `f7576db4667944a0f24944f62dcac02942524b2f`.
Network: Stable Studionet, 61999. The revised deployment at `0x04109e0EA19e022Abdeb51BA907AF468aCEe1Da1` reached
FINALIZED/SUCCESS; deployed source SHA-256 matches
`45bd6d75c17c80f7b4c4628199c1e630b617e456dd2c7316cad2b596d96c7d38`.
Root historical evidence remains byte-for-byte unchanged. Revision 4 transactions and readbacks are in `evidence/revision-4/`.
Revision 3 failed live negative identity consensus; its receipt and 1-testnet-GEN
ledger discrepancy remain under `evidence/revision-3/identity-failure.json`.

| Requirement | Implementation | Executed coverage |
|---|---|---|
| Semantic evidence from immutable code | `_adjudicate` fetches bounded full files at verified merge SHA; prompt includes contents; manifest enters evidence hash; validators compare independently | Code content/hash and SHA-pinned URL assertions; oversized and unavailable file failures; conflicting validator code bytes; existing tier and injected-note tests |
| Claim wallet owns GitHub identity | `_verify_identity` independently verifies contract/bounty/wallet token in profile bio or a default-branch-owned immutable proof file; claim stores numeric ID; PR compares ID and login | Valid claim; wrong-wallet proof refunded with bounty OPEN; same login with wrong numeric ID yields FAKE; unmerged proof, wrong repository owner and wrong proof wallet rejected; existing author mismatch |
| Nonzero challenge period | Deterministic transaction time; 86,400 seconds per evaluated round; strict challenge/execute boundary | Immediate and deadline-minus-one execution blocked; deadline challenge rejected; deadline execution accepted; repeat execution rejected |
| No issuer-only lock | Anyone evaluates, resolves and settles; pending challenge blocks settlement; maximum 2 challenges | Stranger evaluation/resolution/settlement; challenge just before deadline blocks issuer execution; resolved round restarts window; challenge cap; payout conservation |
| Displayed browser account signs | Isolated wallet writer validates account/network, uses explicit `from`, checks temporary signer and selection | Injected signing despite a different cached temp account; disconnect; switched provider account/network; switched display; insufficient temporary balance |
| Temporary payable funding | Existing `sim_fundAccount` route for selected temp address, balance preflight and exact GEN/unit conversion | Correct faucet recipient; injected faucet rejection; faucet failure propagation; exact amount conversion and invalid precision/range |

## Results

- `npm test`: **40 passed**, no failures. Scripted contract/GitHub/model/time harness.
- `npm run test-frontend`: **44 passed**, no failures; bilingual strings check
  passed (102 matching keys). Signing and funding providers are mocked.
- `npm run build-site`: **passed** using locked esbuild dependency.
- `node scripts/deploy.mjs --dry-validate`: **passed** against Stable Studionet;
  chain 61999 and wrong-network rejection checked; RPC returned 19 method schemas.
  This is a read-only schema check, not consensus execution.
- Local headless browser smoke: **blocked before page launch**. Installed Chromium terminated
  at `process_singleton_posix.cc:297`, `socket() failed: Operation not permitted (1)`.
  No page interaction or real wallet transaction was exercised by that attempt.

Raw test/build/schema outputs and the browser limitation are in
`evidence/local-validation/`. Local scores are scripted and do not prove model
judgment quality. Live successful claim proof, immutable code consensus, real browser
signing/funding, 24-hour challenge behavior and new payout receipts remain pending.
Deployment, two funded posts and negative/refund transactions are tracked
separately under revision-3; inspect their receipts and latest readback for exact finality. The revised semantic, challenge and payout mechanisms do not yet have complete
FINALIZED/SUCCESS flow evidence.

The historical on-chain verifier compares deployed source to the working tree;
its source comparison is intentionally incompatible until a new deployment is
recorded. Historical write-flow scripts now reject that mismatch before sending
anything. See [deployment checks](reviewer-fast-path.md) for live acceptance.

## Revision 4 identity safety

Binding is a zero-value transaction. Both negative proofs and temporary retrieval
failures are represented as validator-comparable return data. Payable claims
make no nondeterministic calls and require the stored binding. Local tests assert
that both successful and unbound payable claims cannot access the network or model.
The browser submits the stake only after a successful finalized binding from the
same selected wallet, and displays a rejected operation even when its enclosing
transaction executed successfully.

Real public-browser checks subsequently verified finalized data display, account
selection/disconnection, bilingual switching and the faucet funding the displayed
address with 20 testnet GEN. Those checks do not establish an injected-wallet
signature or a payable browser write. The previous local browser launch failure
remains recorded separately.

## Executed revision 4 chain checks

All transactions below reached FINALIZED with MAJORITY_AGREE/SUCCESS; rejected
operations returned `accepted:false` as expected. The zero-value proof failures
therefore did not repeat revision 3's consensus error.

| Case | Actual result |
|---|---|
| Two funded posts | Both bounties OPEN, 1 testnet GEN each |
| Proof commit not on default branch | Rejected: IDENTITY_COMMIT_NOT_ON_DEFAULT_BRANCH, value 0 |
| Proof for a different contract address | Rejected: GITHUB_WALLET_PROOF_MISSING, value 0 |
| Payable claim without confirmed binding | Rejected: IDENTITY_BINDING_MISSING; full 1 testnet GEN credited |
| Withdrawal of that rejected claim | 1 testnet GEN withdrawn; remaining credit 0 |
| Final ledger and actual contract balance | Received 3 GEN, withdrawn 1 GEN, escrow 2 GEN, actual balance 2 GEN; conservation matched |

Raw hashes, returns and finality are under `evidence/revision-4/validation.json`
and the corresponding complete receipt files. Positive identity, code scoring,
challenge and tier payout acceptance is still incomplete.
