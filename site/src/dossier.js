// Dossier builder. Pure function: its ONLY input is FINALIZED get_*
// readback JSON. Every exported field is copied from the readback, never
// computed locally, never defaulted. Export is refused unless the bounty
// has a settled last_audit from a FINALIZED readback.
export function buildDossier({ bounty, hunter, totals, readBackAt }) {
  if (!bounty || typeof bounty !== 'object') {
    return { ok: false, reason: 'NO_READBACK' };
  }
  if (!bounty.last_audit || typeof bounty.last_audit !== 'object') {
    return { ok: false, reason: 'NOT_SETTLED_NO_FINAL_AUDIT' };
  }
  if (!hunter || typeof hunter !== 'object' || !totals || typeof totals !== 'object') {
    return { ok: false, reason: 'NO_READBACK' };
  }
  const audit = bounty.last_audit;
  const settlement = bounty.settlement || {};
  // Verdict is exhaustive: exactly one branch per tier. PARTIAL is its
  // own branch and never carries a success marker.
  let outcome;
  if (audit.verdict === 'ACCEPT') {
    outcome = { tier: 'ACCEPT', label: 'accepted_full_payout', success_marker: true };
  } else if (audit.verdict === 'PARTIAL') {
    outcome = { tier: 'PARTIAL', label: 'partial_payout_60pct', success_marker: false };
  } else if (audit.verdict === 'REJECT') {
    outcome = { tier: 'REJECT', label: 'rejected_bounty_refunded', success_marker: false };
  } else if (audit.verdict === 'FAKE') {
    outcome = { tier: 'FAKE', label: 'fake_delivery_stake_slashed', success_marker: false };
  } else {
    return { ok: false, reason: 'UNKNOWN_VERDICT' };
  }
  return {
    ok: true,
    dossier: {
      bounty_id: bounty.bounty_id,
      status: bounty.status,
      issuer: bounty.issuer,
      claimed_by: bounty.claimed_by,
      hunter_github_login: bounty.hunter_github_login,
      amount_units: bounty.amount,
      stake_units: bounty.stake,
      expected_repo_slug: bounty.expected_repo_slug,
      requirements: bounty.requirements,
      delivery: bounty.delivery
        ? {
            pr_url: bounty.delivery.pr_url,
            pr_number: bounty.delivery.pr_number,
            note_path: bounty.delivery.note_path,
          }
        : null,
      audit: {
        verdict: audit.verdict,
        completeness_score: audit.completeness_score,
        scope_fit_score: audit.scope_fit_score,
        quality_score: audit.quality_score,
        evidence_hash: audit.evidence_hash,
        pr_number: audit.pr_number,
        merge_sha: audit.merge_sha,
        author_match: audit.author_match,
        file_count: audit.file_count,
        changed_lines: audit.changed_lines,
        commit_hit: audit.commit_hit,
        rationale: audit.rationale,
        round: audit.round,
      },
      settlement: {
        verdict: settlement.verdict,
        hunter_payout_units: settlement.hunter_payout_units,
        issuer_refund_units: settlement.issuer_refund_units,
        hunter_payout_wei: settlement.hunter_payout_wei,
        issuer_refund_wei: settlement.issuer_refund_wei,
        reputation_delta: settlement.reputation_delta,
      },
      outcome,
      hunter: {
        address: hunter.address,
        reputation: hunter.reputation,
        settled: hunter.settled,
        accepted: hunter.accepted,
        partial: hunter.partial,
        rejected: hunter.rejected,
        fake: hunter.fake,
      },
      ledger_totals_wei: {
        total_received_wei: totals.total_received_wei,
        total_withdrawn_wei: totals.total_withdrawn_wei,
        withdrawable_wei: totals.withdrawable_wei,
        escrowed_wei: totals.escrowed_wei,
      },
      read_back_at: readBackAt || null,
      source: 'FINALIZED get_bounty / get_hunter / get_ledger_totals readback',
    },
  };
}

// Hunter dossier builder. Pure function: its ONLY input is FINALIZED get_*
// readback JSON — the hunter record, the ledger totals, and the hunter's
// own bounties with their audits. Every exported field is copied from the
// readback, never computed locally, never defaulted. Export is refused
// unless the hunter record comes from a FINALIZED readback.
export function buildHunterDossier({ hunter, bounties, totals, readBackAt }) {
  if (!hunter || typeof hunter !== 'object') {
    return { ok: false, reason: 'NO_READBACK' };
  }
  if (!totals || typeof totals !== 'object') {
    return { ok: false, reason: 'NO_READBACK' };
  }
  const address = (hunter.address || '').toLowerCase();
  const mine = Object.values(bounties || {})
    .filter((b) => (b.claimed_by || '').toLowerCase() === address)
    .sort((a, b) => String(a.bounty_id).localeCompare(String(b.bounty_id)))
    .map((b) => {
      // Same audit rule as the card: pending verdict while in review, else
      // the settled last audit. Rationale is copied verbatim from readback.
      const audit = b.pending_verdict || b.last_audit || null;
      return {
        bounty_id: b.bounty_id,
        status: b.status,
        expected_repo_slug: b.expected_repo_slug,
        delivery: b.delivery
          ? {
              pr_url: b.delivery.pr_url,
              pr_number: b.delivery.pr_number,
              note_path: b.delivery.note_path,
            }
          : null,
        audit: audit
          ? {
              verdict: audit.verdict,
              completeness_score: audit.completeness_score,
              scope_fit_score: audit.scope_fit_score,
              quality_score: audit.quality_score,
              evidence_hash: audit.evidence_hash,
              rationale: audit.rationale,
              round: audit.round,
            }
          : null,
        settlement: b.settlement
          ? {
              verdict: b.settlement.verdict,
              hunter_payout_units: b.settlement.hunter_payout_units,
              issuer_refund_units: b.settlement.issuer_refund_units,
              hunter_payout_wei: b.settlement.hunter_payout_wei,
              issuer_refund_wei: b.settlement.issuer_refund_wei,
              reputation_delta: b.settlement.reputation_delta,
            }
          : null,
      };
    });
  return {
    ok: true,
    dossier: {
      hunter: {
        address: hunter.address,
        reputation: hunter.reputation,
        settled: hunter.settled,
        accepted: hunter.accepted,
        partial: hunter.partial,
        rejected: hunter.rejected,
        fake: hunter.fake,
      },
      bounties: mine,
      ledger_totals_wei: {
        total_received_wei: totals.total_received_wei,
        total_withdrawn_wei: totals.total_withdrawn_wei,
        withdrawable_wei: totals.withdrawable_wei,
        escrowed_wei: totals.escrowed_wei,
      },
      read_back_at: readBackAt || null,
      source: 'FINALIZED get_hunter / get_all_bounties / get_ledger_totals readback',
    },
  };
}
