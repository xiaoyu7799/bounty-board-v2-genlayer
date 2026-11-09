# Bounty Board — mechanism

Units: 1 unit = 0.001 GEN = 10**15 wei. The ledger (withdrawable balances
and totals) is tracked in wei; bounty amounts and stakes are units.

## State machine

```
OPEN ──claim──► CLAIMED ──submit──► DELIVERED ──evaluate──► VERDICT_PENDING ──execute──► SETTLED_ACCEPT
  │                │                     │                         │  ▲                     SETTLED_PARTIAL
  │ cancel         │ abandon/release     │ withdraw                │  │ challenge            SETTLED_REJECT
  ▼                ▼                     ▼                         │  │                      SETTLED_FAKE
CANCELLED          └──────► OPEN ◄────────┘                 resolve_challenge (re-evaluate, new evidence)
  (terminal)           (claim released back to OPEN, stake returned)   (execution locked while challenged)
```

No clock source is used: expiry is always an explicit trigger (cancel,
abandon, release, withdraw delivery). No state needs time to pass.

## Two-stage adjudication

`evaluate_delivery` (issuer only) runs one nondeterministic step:

**Stage 1 — deterministic gate (pure API facts; any failure is FAKE, no
scoring happens):**

1. The PR URL must be `https://github.com/{owner}/{repo}/pull/{n}`.
2. The repository must equal the `expected_repo_slug` locked at posting
   time. (Submission accepts any well-formed PR URL; the repository check
   is enforced here, by consensus, so a PR from another repository reaches
   evaluation and is judged FAKE with the stake slashed.)
3. `GET /repos/{slug}/pulls/{n}`: 404 is FAKE (PR does not exist); any
   other non-200 is a transient error — nothing is written, the call can
   be retried. The response must have `merged == true` and a 40-hex
   `merge_commit_sha`.
4. `user.login` (lowercased) must equal the registered
   `hunter_github_login`.
5. `GET /pulls/{n}/commits?per_page=100`: at least one commit message must
   contain the full bounty ID.
6. `GET /pulls/{n}/files?per_page=100`: at least 2 code files
   (extension whitelist in the contract) and at least 100 changed lines
   (additions + deletions over code files).
7. `GET /git/trees/{merge_sha}?recursive=1`: `truncated` must be false and
   every changed file must appear in the merged tree.
8. Mirror pre-flight for the committed delivery note (auxiliary pointer
   only; it never decides any fact): the note file is fetched from
   `raw.githubusercontent.com/{slug}/{merge_sha}/{note_path}` and from
   `cdn.jsdelivr.net/gh/{slug}@{merge_sha}/{note_path}`. If both serve and
   disagree, the call errors and nothing is written (retry later). If the
   note file does not exist, the note is treated as absent and the
   evaluation proceeds on the API facts.

**Stage 2 — semantic scoring (only if stage 1 passes):**

The prompt carries the locked requirements, the API facts (PR number,
author, merge SHA, file list, changed lines, bounty-ID commit hit) and
the hunter's delivery note, delimited as untrusted data with an explicit
instruction to ignore embedded instructions. It returns three integer
scores (completeness / scope fit / quality, 0–100). The tier follows
from the scores: ACCEPT needs ≥80 / ≥80 / ≥70; PARTIAL needs ≥50 / ≥50;
otherwise REJECT.

**Validator agreement:** every validator independently re-fetches the
GitHub API and re-scores. The leader's result is accepted only if every
deterministic field matches exactly, each score is within ±10, and the
tier derived from the scores is identical. Money and reputation follow
the tier only, so the worst-case spread on payouts and reputation is 0.

## Money

- All payouts are pull payments. `withdraw()` zeroes the credit before
  emitting the transfer.
- Conservation: `total_received_wei == total_withdrawn_wei +
  withdrawable_wei + escrowed_wei`, where escrowed is also recomputed
  per bounty (`get_ledger_totals` returns both).
- Failed payable calls never take money: `post_bounty` and `claim_bounty`
  reject invalid calls and credit the full sent value back to the sender
  as a withdrawable credit. Non-payable writes credit back any GEN sent
  with them before doing anything else. (On Studionet a raised payable
  call keeps the value while state reverts, so payable entry points never
  raise while holding value.)

## Sender binding

| Operation | Who can call |
|---|---|
| `post_bounty` | anyone (becomes the issuer); value must equal the amount exactly |
| `claim_bounty` | anyone except the issuer; reputation ≥ minimum; exact stake |
| `submit_delivery` / `withdraw_delivery` | the claiming hunter only |
| `evaluate_delivery` | the issuer only |
| `challenge_verdict` | the claiming hunter only; new PR URL + reason + a claimed tier different from the pending one; max 2 challenges |
| `resolve_challenge` | the issuer only; re-runs the full adjudication on the new PR |
| `execute_verdict` | the issuer or the claiming hunter; locked while a challenge is pending |
| `abandon_claim` | the claiming hunter only; stake returned |
| `release_claim` | the issuer only; stake returned to the hunter |
| `cancel_bounty` | the issuer only, while OPEN; bounty refunded |
| `withdraw` | anyone with a withdrawable balance; own balance only |
| `record_contradiction_claim` | anyone; needs a settled audit and a claimed tier different from it; appends a witness, never changes the settlement |

## Challenge

A challenge carries a new PR URL (the same PR with new commits, or a new
PR) and a reason. Resolution re-runs the full two-stage adjudication
against the live PR state, so the second round judges new input, and
supersedes the pending verdict. After 2 challenges the verdict is
executable and cannot be delayed further.

## Views (no wallet needed)

`get_bounty`, `get_all_bounties`, `get_hunter`, `get_withdrawable`,
`get_ledger_totals`. The website displays only values read back from
these after a FINALIZED transaction; before any readback it shows
"unconfirmed".
