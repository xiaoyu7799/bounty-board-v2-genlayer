// Kanban board rendering for the Bounty Board (bb-0003).
// Pure functions of the FINALIZED readback snapshot: given the bounties
// and the translation function, they return HTML strings. No chain reads
// and no local state live here; the app owns the snapshot.
export function columnKeyForStatus(status) {
  if (status === 'OPEN') return 'OPEN';
  if (status === 'CLAIMED') return 'CLAIMED';
  if (status === 'DELIVERED' || status === 'VERDICT_PENDING') return 'REVIEW';
  return 'SETTLED';
}

export function columnTitleKey(columnKey) {
  if (columnKey === 'OPEN') return 'colOpen';
  if (columnKey === 'CLAIMED') return 'colClaimed';
  if (columnKey === 'REVIEW') return 'colReview';
  return 'colSettled';
}

export function verdictTag(audit, t) {
  if (!audit) return `<span class="tag tag-mist">${esc(t('unconfirmed'))}</span>`;
  if (audit.verdict === 'ACCEPT') return `<span class="tag tag-pine">${esc(t('acceptedLabel'))}</span>`;
  if (audit.verdict === 'PARTIAL') return `<span class="tag tag-ink">${esc(t('partialLabel'))}</span>`;
  if (audit.verdict === 'REJECT') return `<span class="tag tag-signal">${esc(t('rejectedLabel'))}</span>`;
  if (audit.verdict === 'FAKE') return `<span class="tag tag-signal">${esc(t('fakeLabel'))}</span>`;
  return `<span class="tag tag-mist">${esc(t('unconfirmed'))}</span>`;
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function fmtGenFromUnits(units, t) {
  return `${(Number(units) / 1000).toFixed(3)} ${t('genUnit')}`;
}

function shortAddr(address, t) {
  if (!address) return t('empty');
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function bountyCard(bounty, t, actionsHtml = '') {
  const audit = bounty.pending_verdict || bounty.last_audit;
  const status = bounty.status || 'OPEN';
  return `<article class="bounty-card" data-bounty="${esc(bounty.bounty_id)}" tabindex="0">
    <header><h3>${esc(bounty.bounty_id)}</h3><span class="status">${esc(status)}</span></header>
    <p class="req">${esc(bounty.requirements || '')}</p>
    <dl>
      <div><dt>${esc(t('amount'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.amount || 0, t))}</dd></div>
      <div><dt>${esc(t('stake'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.stake || 0, t))}</dd></div>
      <div><dt>${esc(t('issuer'))}</dt><dd class="mono">${esc(shortAddr(bounty.issuer, t))}</dd></div>
      <div><dt>${esc(t('hunter'))}</dt><dd class="mono">${esc(bounty.claimed_by ? shortAddr(bounty.claimed_by, t) : t('empty'))}</dd></div>
      <div><dt>${esc(t('targetRepo'))}</dt><dd class="mono">${esc(bounty.expected_repo_slug || '')}</dd></div>
      ${bounty.delivery ? `<div><dt>${esc(t('prLink'))}</dt><dd><a class="mono" href="${esc(bounty.delivery.pr_url)}" target="_blank" rel="noreferrer">${esc(t('githubPr'))} #${esc(bounty.delivery.pr_number)}</a></dd></div>` : ''}
      ${audit ? `<div><dt>${esc(t('verdict'))}</dt><dd>${verdictTag(audit, t)}</dd></div>
      <div><dt>${esc(t('scores'))}</dt><dd class="mono">${esc(audit.completeness_score)} / ${esc(audit.scope_fit_score)} / ${esc(audit.quality_score)}</dd></div>
      <div><dt>${esc(t('evidenceHash'))}</dt><dd class="mono">${esc(String(audit.evidence_hash || '').slice(0, 16))}…</dd></div>
      ${audit.rationale ? `<div><dt>${esc(t('rationale'))}</dt><dd>${esc(audit.rationale)}</dd></div>` : ''}` : ''}
      ${bounty.settlement ? `<div><dt>${esc(t('payout'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.settlement.hunter_payout_units || 0, t))}</dd></div>
      <div><dt>${esc(t('refund'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.settlement.issuer_refund_units || 0, t))}</dd></div>` : ''}
      ${bounty.status === 'VERDICT_PENDING' ? `<div><dt>—</dt><dd>${esc(t('pendingExecution'))}</dd></div>` : ''}
      ${bounty.challenge ? `<div><dt>—</dt><dd>${esc(t('challengePending'))}</dd></div>` : ''}
    </dl>
    <div class="card-actions">${actionsHtml}</div>
  </article>`;
}

// Four status columns, fed by the readback snapshot. Cards are grouped by
// their live status; the REVIEW column holds both DELIVERED and
// VERDICT_PENDING bounties.
export function renderKanban(bounties, t, actionsFor = () => '') {
  const columns = { OPEN: [], CLAIMED: [], REVIEW: [], SETTLED: [] };
  for (const bounty of Object.values(bounties || {})) {
    columns[columnKeyForStatus(bounty.status || 'OPEN')].push(bounty);
  }
  const col = (key, list) => `<section class="kanban-col"><h3>${esc(t(columnTitleKey(key)))} <span class="count">${list.length}</span></h3>${list.map((b) => bountyCard(b, t, actionsFor(b))).join('') || `<p class="empty">${esc(t('empty'))}</p>`}</section>`;
  return (
    col('OPEN', columns.OPEN) +
    col('CLAIMED', columns.CLAIMED) +
    col('REVIEW', columns.REVIEW) +
    col('SETTLED', columns.SETTLED)
  );
}
