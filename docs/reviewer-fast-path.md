# Reviewer fast path

Contract: `0xa926EFede20F0D4Daaa29cfba42a3C57f8c2acd3` (Stable Studionet, 61999)
Explorer: https://explorer-studio.genlayer.com/address/0xa926EFede20F0D4Daaa29cfba42a3C57f8c2acd3
Website: https://xiaoyu7799.github.io/bounty-board-v2-genlayer/
Evidence: `evidence/evidence.json` (every core transaction: hash,
FINALIZED receipt, read-back).

## 1. The deployed code is the repo code

```sh
# fetch the deployed code (base64) and compare its SHA-256 with the repo file
node -e "import('./scripts/network.mjs').then(async (n) => {
  const { createHash } = await import('node:crypto');
  const fs = await import('node:fs');
  const code = await n.rpc('gen_getContractCode', ['0xa926EFede20F0D4Daaa29cfba42a3C57f8c2acd3']);
  const sha = createHash('sha256').update(Buffer.from(code, 'base64').toString('utf8')).digest('hex');
  console.log('deployed:', sha);
  console.log('repo    :', createHash('sha256').update(fs.readFileSync('contracts/bounty_board.py')).digest('hex'));
})"
```

Expected SHA-256: `f7f6a84f66c69aaa3e77ffde8fbd9f60b667a689baee3c2e746e9ba31a061964`.

## 2. Read the state back (no wallet needed)

```sh
node scripts/verify.mjs   # re-reads every receipt and every read-back in evidence/evidence.json
```

Or read directly: `get_all_bounties`, `get_ledger_totals`,
`get_hunter(<address>)`, `get_withdrawable(<address>)` via
`gen_call` with `transaction_hash_variant: latest-final`.

## 3. Check the verdict tiers on chain

- `bb-0001` → SETTLED_ACCEPT: real frontend delivery PR, merged, author
  matches, bounty ID in a commit message, 2+ code files, 100+ lines.
- `bb-0002` → SETTLED_PARTIAL: real but incomplete delivery (JSON export
  only, no CSV).
- `bb-0003` → first REJECT, then challenged with a new PR and flipped to
  SETTLED_ACCEPT.
- `bb-0004` → SETTLED_FAKE: PR self-merged in the hunter's own
  repository — but the bounty itself targeted that repository, so the
  FAKE came from the code-change gate (0 code files / 0 changed lines),
  not the repository gate; stake slashed to the issuer.
- `bb-0007` → SETTLED_FAKE via REPO_MISMATCH: the bounty targets
  `xiaoyu7799/bounty-board-v2-genlayer` while the delivered PR is
  `xiaoyu7799/bounty-fake-delivery/pull/1`; consensus judged it FAKE
  with the stake slashed.

## 4. Check the money

`get_ledger_totals` returns `total_received_wei`,
`total_withdrawn_wei`, `withdrawable_wei`, `escrowed_wei`, and
`escrowed_wei_recomputed` (recomputed per bounty). The identity
`received == withdrawn + withdrawable + escrowed` holds at every step,
and the two escrowed figures agree.

## 5. Run the tests

```sh
npm test            # contract mock tests (23+ cases: all tiers, all FAKE gates, challenge flip, sender binding, conservation)
node --test tests/dossier.test.mjs   # dossier export: readback-only, PARTIAL branch, refusal without readback
node scripts/i18n_check.mjs         # bilingual keys, zero missing
```
