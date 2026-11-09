# Known limitations

- **GitHub API page size.** The commits and files endpoints are read with
  `per_page=100`. A pull request with more than 100 commits is judged on
  the first 100 commit messages (the bounty-ID check only needs one hit);
  a pull request with more than 100 changed files is judged on the first
  100 files. Very large deliveries should be split across pull requests.
- **Tree size.** A merged repository tree reported as `truncated` cannot
  be verified file by file, so the deterministic gate judges it FAKE.
  Ordinary repositories are far below the truncation limit.
- **Semantic scores are LLM judgements.** The three scores (0–100) are
  re-scored independently by every validator with a ±10 tolerance, and
  the tier must agree exactly. Payouts and reputation follow the tier
  only, never the raw scores.
- **Bounty amounts are nominal testnet GEN.** Studionet GEN is free via
  the faucet; amounts are 1–200 GEN per bounty.
- **No clock source.** Expiry is always an explicit trigger (cancel,
  abandon, release, withdraw delivery); nothing expires automatically.
- **Browser wallet writes.** Any injected EVM wallet can connect and
  read. Writes in the browser use a clearly labelled temporary test
  account generated in the browser; the wallet-signing path is not the
  one exercised by the scripted evidence run.
