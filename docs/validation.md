# Revised contract validation

Original baseline: `f7576db4667944a0f24944f62dcac02942524b2f`.
Current deployed contract: `0x04109e0EA19e022Abdeb51BA907AF468aCEe1Da1`.
Network: Stable Studionet, 61999. Source SHA-256:
`45bd6d75c17c80f7b4c4628199c1e630b617e456dd2c7316cad2b596d96c7d38`.
Deployment is FINALIZED/SUCCESS; independent code readback matches this hash.

## Reproducible local checks

| Command | Actual result | Scope |
|---|---|---|
| `npm test` | 40 passed | Scripted GitHub/model/time contract harness; normal, failure and adversarial paths |
| `npm run test-frontend` | 44 passed; 102 bilingual keys matched | Wallet/account/network routing, value conversion, rejected returns and bind-before-stake order, existing frontend logic |
| `npm run build-site` | Passed | Locked esbuild production bundle |
| `node scripts/deploy.mjs --dry-validate` | Passed; 19 methods | Read-only schema check against chain 61999; wrong-chain rejection checked |

Raw output is in `evidence/local-validation/`. Scripted scores are not live
consensus evidence. The local headless browser failed before launch because
Chromium could not open its singleton socket; this failure remains recorded.
Separate real cloud-browser checks subsequently verified finalized data display,
account selection/disconnection, bilingual switching and a real faucet credit
of 20 testnet GEN to the displayed address. Injected-wallet real signatures and
payable browser writes are not claimed by those checks.

## Executed revision 4 chain checks

| Case | Observed result |
|---|---|
| Two funded posts | FINALIZED/SUCCESS, 1 GEN each |
| Unmerged proof | FINALIZED/SUCCESS; rejected with IDENTITY_COMMIT_NOT_ON_DEFAULT_BRANCH; value 0 |
| Cross-contract proof | FINALIZED/SUCCESS; rejected with GITHUB_WALLET_PROOF_MISSING; value 0 |
| Unbound payable claim | FINALIZED/SUCCESS; rejected with IDENTITY_BINDING_MISSING; full 1-GEN credit |
| Refund withdrawal | FINALIZED/SUCCESS; actual 1-GEN withdrawal; credit returned to 0 |
| Correct identity binding and stake | Both bounties FINALIZED/SUCCESS; numeric GitHub ID 350620374 bound to the same claimant wallet |
| Immutable code adjudication | FINALIZED/SUCCESS; ACCEPT; 3 files, 129 changed lines, verified merge SHA c0788e8ab9113b7f0a97f683dd98c47ba7ba3182 |
| Code/evidence digest verification | Every file SHA-256 independently matched; canonical evidence hash independently recomputed and matched |
| Wrong-repository delivery | FINALIZED/SUCCESS; FAKE |
| Early settlement | FINALIZED expected execution error CHALLENGE_WINDOW_OPEN; complete receipt retained |
| Hunter challenge | FINALIZED/SUCCESS |
| Issuer execution during challenge | FINALIZED expected execution error PENDING_CHALLENGE_BLOCKS_EXECUTION; complete receipt retained |
| Stranger challenge resolution | FINALIZED/SUCCESS; ACCEPT; readback round 2, challenge_count 1, no pending challenge |
| Latest conservation | Received 5 GEN, withdrawn 1 GEN, escrow 4 GEN, actual contract balance 4 GEN; all matched |

The code case's restarted deadline is **2026-11-15 10:12:14 Asia/Shanghai**
(02:12:14 UTC). The FAKE case deadline is 10:07:13 Asia/Shanghai.
Final tier settlement, payee withdrawals and payable browser signing remain
unverified until the genuine deadlines expire. No simulation time is advanced.
Complete hashes, returns, receipts and state snapshots are under
`evidence/revision-4/`; `validation.json` distinguishes expected errors from
successful operations. Only participating validator majority agreement is claimed.

## Historical failure retained

Revision 3's negative identity test
`0x5b6ec000668a673b41544500ddd8318c1b266dde01a3a11865ed5a08448cea35`
finalized with MAJORITY_DISAGREE/ERROR and left 1 testnet GEN outside that
contract's recorded ledger. Its original receipt, source hash, state readback and
measured balance discrepancy remain in `evidence/revision-3/`. Revision 4 fixes
the value-bearing path by binding identity in a separate zero-value transaction
and keeping payable claims deterministic. It does not repair the old ledger.
Root historical receipts from earlier deployments remain unchanged and are not
used to prove revision 4 behavior.
