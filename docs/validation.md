# Validation of revised source

Base commit: `f7576db4667944a0f24944f62dcac02942524b2f`.
Network: Stable Studionet, 61999. The revised deployment at `0xb783CD72882e4403aC236237Ab231cfED7172f49` reached
FINALIZED/SUCCESS; deployed source SHA-256 matches
`c12961d63d460d688df8c58470befd19b46c7254cf3bd8e64bffc1a87256181b`.
Root historical evidence remains byte-for-byte unchanged. Revised transactions
and readbacks are in `evidence/revision-3/`.

| Requirement | Implementation | Executed coverage |
|---|---|---|
| Semantic evidence from immutable code | `_adjudicate` fetches bounded full files at verified merge SHA; prompt includes contents; manifest enters evidence hash; validators compare independently | Code content/hash and SHA-pinned URL assertions; oversized and unavailable file failures; conflicting validator code bytes; existing tier and injected-note tests |
| Claim wallet owns GitHub identity | `_verify_identity` independently verifies contract/bounty/wallet token in profile bio or a default-branch-owned immutable proof file; claim stores numeric ID; PR compares ID and login | Valid claim; wrong-wallet proof refunded with bounty OPEN; same login with wrong numeric ID yields FAKE; unmerged proof, wrong repository owner and wrong proof wallet rejected; existing author mismatch |
| Nonzero challenge period | Deterministic transaction time; 86,400 seconds per evaluated round; strict challenge/execute boundary | Immediate and deadline-minus-one execution blocked; deadline challenge rejected; deadline execution accepted; repeat execution rejected |
| No issuer-only lock | Anyone evaluates, resolves and settles; pending challenge blocks settlement; maximum 2 challenges | Stranger evaluation/resolution/settlement; challenge just before deadline blocks issuer execution; resolved round restarts window; challenge cap; payout conservation |
| Displayed browser account signs | Isolated wallet writer validates account/network, uses explicit `from`, checks temporary signer and selection | Injected signing despite a different cached temp account; disconnect; switched provider account/network; switched display; insufficient temporary balance |
| Temporary payable funding | Existing `sim_fundAccount` route for selected temp address, balance preflight and exact GEN/unit conversion | Correct faucet recipient; injected faucet rejection; faucet failure propagation; exact amount conversion and invalid precision/range |

## Results

- `npm test`: **36 passed**, no failures. Scripted contract/GitHub/model/time harness.
- `npm run test-frontend`: **40 passed**, no failures; bilingual strings check
  passed (102 matching keys). Signing and funding providers are mocked.
- `npm run build-site`: **passed** using locked esbuild dependency.
- `node scripts/deploy.mjs --dry-validate`: **passed** against Stable Studionet;
  chain 61999 and wrong-network rejection checked; RPC returned 18 method schemas.
  This is a read-only schema check, not consensus execution.
- Browser smoke: **blocked before page launch**. Installed Chromium terminated
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
