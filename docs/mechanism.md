# Bounty Board mechanism

Amounts use 0.001 GEN units; credits and transfers use wei. Posting and claiming
accept exact value only; rejected payable calls credit the sender for withdrawal.
The original tier split, reputation floor, cancellation and pull-payment ledger
remain unchanged.

## Evidence

The API gate verifies locked repository, merged status, merge SHA, PR author
login **and numeric ID**, bounty-ID commit, minimum code changes and merged tree
membership. Identity is verified in a zero-value `bind_github_identity` transaction through a wallet-, bounty-, network-
and contract-specific token in the GitHub user's public profile bio, or in
`identity/<wallet>/<bounty>.txt` at a supplied immutable commit in an owned
repository. Repository proofs verify `owner.id`, login and default-branch ancestry
through the compare API before reading the exact token. Fork-only commits fail. Each
validator fetches that profile independently. The PR-author identity is then
compared to the immutable claim record, rather than a user-supplied name alone.

After the gate, full changed code files are fetched from
`https://raw.githubusercontent.com/<slug>/<verified-merge-sha>/<encoded-path>`.
At most 8 code files, 12,000 UTF-8 bytes per file, 48,000 bytes combined are
accepted. Contents are never silently truncated. A file list at the 100-file
pagination boundary or inconsistent with `changed_files` is refused. Missing
code, oversized code or unavailable APIs abort without assigning a verdict.

The prompt contains these immutable contents and their paths, requirements and
API facts. User notes and challenge reasons remain untrusted claims. Every
validator repeats retrieval and scoring. Exact code manifests and evidence
hashes must agree; score tolerance is 10 and the tier must match. A hash without
its underlying code in the prompt is insufficient for semantic adjudication.

## State and permissions

| Transition | Caller | Constraint |
|---|---|---|
| Identity binding (OPEN) | prospective hunter | zero value; independently verified proof |
| OPEN → CLAIMED | hunter, not issuer | confirmed binding, exact stake, reputation; no external calls |
| CLAIMED → DELIVERED | hunter | valid PR URL and bounded note |
| DELIVERED → VERDICT_PENDING | anyone | successful consensus, 24-hour deadline |
| VERDICT_PENDING → challenged | hunter | before deadline, at most 2 challenges |
| challenged → VERDICT_PENDING | anyone | full re-evaluation; new 24-hour deadline |
| VERDICT_PENDING → SETTLED tier | anyone | no challenge and timestamp ≥ deadline |
| CLAIMED → OPEN | hunter or issuer | stake returned |
| DELIVERED → CLAIMED | hunter | withdraw submission |
| OPEN → CANCELLED | issuer | bounty credited back |

Time comes from `gl.message_raw['datetime']`, the deterministic transaction
context, not a caller argument or host clock. Challenge accepts strictly before
the deadline; execution accepts at or after it. Pending challenges always block
execution even after that timestamp. Permissionless evaluation, resolution and
settlement remove issuer-only locks. No automatic background execution exists:
someone must send the trigger transaction. Persistent upstream outages can still
block consensus resolution, as documented in known limitations.

Settlement updates credits exactly once and always pays the recorded hunter
and issuer. Trigger callers cannot redirect funds. Contradiction witnesses
append after settlement and never change payouts.

## Identity rejection and value safety

Both valid and invalid identity proofs return ordinary structured data from the
nondeterministic step. Validators compare that data independently. Negative
proofs are reported as rejected operations, rather than relying on validation
of a raised leader result. Binding is non-payable; payable claims use only the
confirmed binding. This separates GitHub availability and consensus from stake
transfer. The browser waits for binding finality and checks the selected account
again before claiming. A successful transaction with `accepted:false` is displayed
as a rejected operation, with the transaction hash and reason.
