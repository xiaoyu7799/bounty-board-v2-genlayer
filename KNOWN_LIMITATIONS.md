# Known limitations

- Revised code is deployed with matching source hash. Full identity, semantic
  consensus, challenge and settlement acceptance remains incomplete. Historical
  receipts belong to the old contract and do not prove the revised mechanisms.
- GitHub profile control is proved through public bio content, not OAuth or a
  GitHub-issued cryptographic attestation. The alternative repository-file proof
  trusts control of an account-owned repository and its default branch, including
  any collaborators authorized to merge there. GitHub API authenticity and availability
  are trusted. A compromised GitHub account can authorize another wallet; numeric
  IDs prevent simple login reuse from satisfying the PR-author check.
- Code evidence is deliberately bounded: at most 8 code files, 12,000 UTF-8 bytes
  each, 48,000 bytes total. Unsupported deliveries must be split or reduced.
  Lists reaching 100 files and truncated repository trees cannot be fully checked.
  The commit-message check reads the first 100 commit messages only.
- Semantic scores are LLM judgments. Local scripted scores test wiring and
  equivalence rules; they do not establish real model quality or immunity to
  prompt injection. Exact evidence and tier agreement are required.
- Permissionless resolution still needs a successful GitHub/model consensus
  transaction. Persistent upstream failures can delay a pending challenge.
  There is no unilateral issuer shortcut that settles challenged work.
- Challenge deadlines use transaction timestamps, not finalization timestamps.
  Clients should challenge well before expiry; queued transactions or prolonged
  finalization can reduce the practical response time.
- The browser faucet uses `sim_fundAccount`, the existing Studionet funding route.
  Live revised browser signing, funding and payable flows still require testing.
  Temporary keys disappear on page closure; pending payouts then become inaccessible.
- Browser smoke testing in this environment was blocked before page launch by
  Chromium's process singleton socket permission failure. Module-level wallet
  tests and the production bundle build were executed separately.

- Revision 3 failed its live negative identity test: transaction
  `0x5b6ec000668a673b41544500ddd8318c1b266dde01a3a11865ed5a08448cea35`
  finalized with MAJORITY_DISAGREE/ERROR. Its payable value of 1 testnet GEN
  remained outside the contract's recorded ledger. The original receipt, code
  hash, ledger readback and observed balance discrepancy are preserved under
  `evidence/revision-3/`. This version must not be used for new claims. The next
  revision moves GitHub validation to a zero-value binding transaction and keeps
  payable claims deterministic; this does not repair the old contract's ledger.
