// Bounty Board v2 — frontend.
// Display rule (Gate 11): every displayed or exported value comes from a
// FINALIZED get_* readback snapshot. Before a readback, fields show
// "unconfirmed". No seed data, no local simulation feeds any display,
// export, score, or payout field.
import { createAccount, abi } from 'genlayer-js';
import { encodeFunctionData } from 'viem';
import { studionet } from 'genlayer-js/chains';
import { APP_CONFIG } from './config.js';
import { STRINGS, t } from './i18n.js';
import { buildDossier } from './dossier.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { calldata, transactions } = abi;

let lang = localStorage.getItem('bb-lang') || 'zh';
let snapshot = null; // { bounties, hunters, totals, readBackAt } or null
let readingBack = false;
let selectedBountyId = null;
let selectedHunter = null;
let wallet = null; // { kind: 'injected'|'temp', address, label }
let tempAccount = null; // in-memory only; never serialized or stored

const chain = { ...studionet, rpcUrls: { default: { http: [APP_CONFIG.RPC_URL] } } };

// ------------------------------------------------------------------
// Chain reads (fetch-based gen_call, latest-final, with retries).
// ------------------------------------------------------------------
function encoded(method, args = []) {
  return transactions.serialize([calldata.encode(calldata.makeCalldataObject(method, args, {})), false]);
}

async function rpcCall(method, params = []) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(APP_CONFIG.RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    if (!res.ok) {
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    let body;
    try {
      body = await res.json();
    } catch {
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    return body.result;
  }
  throw new Error('RPC_RETRY_EXHAUSTED');
}

async function readFinal(functionName, args = []) {
  const result = await rpcCall('gen_call', [{
    type: 'read',
    to: APP_CONFIG.CONTRACT_ADDRESS,
    from: '0x0000000000000000000000000000000000000000',
    data: encoded(functionName, args),
    transaction_hash_variant: 'latest-final',
  }]);
  if (result && typeof result === 'object' && result.status && result.status.code !== 0) {
    throw new Error(result.status.message);
  }
  const hex = typeof result === 'string' ? result : result?.data;
  if (typeof hex !== 'string') throw new Error('INVALID_READ_RESULT');
  const plain = hex.startsWith('0x') ? hex.slice(2) : hex;
  return calldata.decode(Uint8Array.from(plain.match(/../g) || [], (x) => parseInt(x, 16)));
}

async function readJson(functionName, args = []) {
  return JSON.parse(await readFinal(functionName, args));
}

async function refreshSnapshot() {
  readingBack = true;
  renderStatus();
  try {
    const all = await readJson('get_all_bounties', []);
    const totals = await readJson('get_ledger_totals', []);
    const addresses = new Set();
    for (const b of Object.values(all.bounties || {})) {
      if (b.issuer) addresses.add(b.issuer.toLowerCase());
      if (b.claimed_by) addresses.add(b.claimed_by.toLowerCase());
    }
    const hunters = {};
    for (const address of addresses) {
      hunters[address] = await readJson('get_hunter', [address]);
    }
    snapshot = {
      bounties: all.bounties || {},
      hunters,
      totals,
      readBackAt: new Date().toISOString(),
    };
  } catch (error) {
    setNotice(`${t(lang, 'txError')} (${error.message})`, 'error');
  } finally {
    readingBack = false;
    renderAll();
  }
}

// ------------------------------------------------------------------
// Chain writes. Signing account is the in-browser ephemeral test
// account (generated here, keys never leave this browser). Injected
// wallets are used for connecting and reading; writes are never
// presented as the injected wallet's signature.
// ------------------------------------------------------------------
function envelope(sender, to, data) {
  const entry = chain.consensusMainContract.abi.find(
    (x) => x.type === 'function' && x.name === 'addTransaction');
  const args = [sender, to, 5, 3, data];
  if (entry.inputs.length === 6) args.push(BigInt(Math.floor(Date.now() / 1000) + 3600));
  return encodeFunctionData({ abi: [entry], functionName: 'addTransaction', args });
}

async function waitFinalized(hash, timeoutMs = 15 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpcCall('eth_getTransactionByHash', [hash]);
    if (receipt?.status === 'FINALIZED') return receipt;
    await sleep(6000);
  }
  return null;
}

async function sendWrite(method, args, valueWei = 0n) {
  if (!tempAccount) throw new Error('ENABLE_TEMPORARY_TEST_ACCOUNT');
  const data = transactions.serialize([
    calldata.encode(calldata.makeCalldataObject(method, args, {})), false]);
  const nonce = await rpcCall('eth_getTransactionCount', [tempAccount.address, 'latest']);
  const serialized = await tempAccount.signTransaction({
    chainId: APP_CONFIG.CHAIN_ID,
    type: 'legacy',
    to: chain.consensusMainContract.address,
    data: envelope(tempAccount.address, APP_CONFIG.CONTRACT_ADDRESS, data),
    nonce: Number(BigInt(nonce)),
    gas: 20000000n,
    gasPrice: 0n,
    value: BigInt(valueWei),
  });
  return rpcCall('eth_sendRawTransaction', [serialized]);
}

async function runWrite(label, method, args, valueWei = 0n) {
  setNotice(`${t(lang, 'txSubmitted')}: ${label}…`, 'info');
  let hash;
  try {
    hash = await sendWrite(method, args, valueWei);
  } catch (error) {
    setNotice(`${t(lang, 'txError')} (${error.message})`, 'error');
    return null;
  }
  setNotice(`${t(lang, 'txSubmitted')}: ${String(hash).slice(0, 18)}… — ${t(lang, 'readingBack')}`, 'info');
  const receipt = await waitFinalized(hash);
  if (!receipt) {
    setNotice(`${t(lang, 'txError')} (FINALIZED timeout ${String(hash).slice(0, 18)}…)`, 'error');
    return null;
  }
  const leaders = receipt.consensus_data?.leader_receipt;
  const leader = Array.isArray(leaders)
    ? leaders.find((x) => x.mode === 'leader') || leaders[0]
    : leaders;
  if (receipt.result_name !== 'MAJORITY_AGREE' || leader?.execution_result !== 'SUCCESS') {
    setNotice(`${t(lang, 'txFailed')}: ${receipt.result_name}/${leader?.execution_result}`, 'error');
    return null;
  }
  setNotice(`${t(lang, 'txFinalized')}: ${String(hash).slice(0, 18)}…`, 'ok');
  await refreshSnapshot();
  return receipt;
}

// ------------------------------------------------------------------
// Wallet.
// ------------------------------------------------------------------
async function connectInjected() {
  const provider = window.okxwallet || window.ethereum;
  if (!provider) {
    setNotice(t(lang, 'noWallet'), 'error');
    return;
  }
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const chainIdHex = await provider.request({ method: 'eth_chainId' });
    if (parseInt(chainIdHex, 16) !== APP_CONFIG.CHAIN_ID) {
      setNotice(t(lang, 'wrongNetwork'), 'error');
      return;
    }
    wallet = {
      kind: 'injected',
      address: (accounts[0] || '').toLowerCase(),
      label: `${window.okxwallet ? 'OKX Wallet' : 'Injected EVM Wallet'} ${(accounts[0] || '').slice(0, 6)}…${(accounts[0] || '').slice(-4)}`,
    };
    renderWallet();
    renderAll();
  } catch (error) {
    setNotice(`${t(lang, 'txError')} (${error.message})`, 'error');
  }
}

function useTempAccount() {
  if (!tempAccount) tempAccount = createAccount();
  wallet = {
    kind: 'temp',
    address: tempAccount.address.toLowerCase(),
    label: `${tempAccount.address.slice(0, 6)}…${tempAccount.address.slice(-4)} (${t(lang, 'walletTemp')})`,
  };
  renderWallet();
  renderAll();
}

function disconnectWallet() {
  wallet = null;
  renderWallet();
  renderAll();
}

// ------------------------------------------------------------------
// Formatting. Units: 1 unit = 0.001 GEN. Wei: 1 GEN = 10**18 wei.
// ------------------------------------------------------------------
function fmtGenFromUnits(units) {
  return `${(Number(units) / 1000).toFixed(3)} ${t(lang, 'genUnit')}`;
}
function fmtGenFromWei(wei) {
  return `${(Number(BigInt(wei)) / 1e18).toFixed(3)} ${t(lang, 'genUnit')}`;
}
function shortAddr(address) {
  if (!address) return t(lang, 'empty');
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ------------------------------------------------------------------
// Rendering. Everything reads the snapshot; without one, fields show
// "unconfirmed" and never a value.
// ------------------------------------------------------------------
function verdictBlock(bounty) {
  const audit = bounty.pending_verdict || bounty.last_audit;
  if (!audit) return `<span class="tag tag-mist">${esc(t(lang, 'unconfirmed'))}</span>`;
  const v = audit.verdict;
  if (v === 'ACCEPT') return `<span class="tag tag-pine">${esc(t(lang, 'acceptedLabel'))}</span>`;
  if (v === 'PARTIAL') return `<span class="tag tag-ink">${esc(t(lang, 'partialLabel'))}</span>`;
  if (v === 'REJECT') return `<span class="tag tag-signal">${esc(t(lang, 'rejectedLabel'))}</span>`;
  if (v === 'FAKE') return `<span class="tag tag-signal">${esc(t(lang, 'fakeLabel'))}</span>`;
  return `<span class="tag tag-mist">${esc(t(lang, 'unconfirmed'))}</span>`;
}

function bountyCard(bounty) {
  const audit = bounty.pending_verdict || bounty.last_audit;
  const status = bounty.status || 'OPEN';
  const actions = actionButtons(bounty);
  return `<article class="bounty-card" data-bounty="${esc(bounty.bounty_id)}" tabindex="0">
    <header><h3>${esc(bounty.bounty_id)}</h3><span class="status">${esc(status)}</span></header>
    <p class="req">${esc(bounty.requirements || '')}</p>
    <dl>
      <div><dt>${esc(t(lang, 'amount'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.amount || 0))}</dd></div>
      <div><dt>${esc(t(lang, 'stake'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.stake || 0))}</dd></div>
      <div><dt>${esc(t(lang, 'issuer'))}</dt><dd class="mono">${esc(shortAddr(bounty.issuer))}</dd></div>
      <div><dt>${esc(t(lang, 'hunter'))}</dt><dd class="mono">${esc(bounty.claimed_by ? shortAddr(bounty.claimed_by) : t(lang, 'empty'))}</dd></div>
      <div><dt>${esc(t(lang, 'targetRepo'))}</dt><dd class="mono">${esc(bounty.expected_repo_slug || '')}</dd></div>
      ${bounty.delivery ? `<div><dt>${esc(t(lang, 'prLink'))}</dt><dd><a class="mono" href="${esc(bounty.delivery.pr_url)}" target="_blank" rel="noreferrer">${esc(t(lang, 'githubPr'))} #${esc(bounty.delivery.pr_number)}</a></dd></div>` : ''}
      ${audit ? `<div><dt>${esc(t(lang, 'verdict'))}</dt><dd>${verdictBlock(bounty)}</dd></div>
      <div><dt>${esc(t(lang, 'scores'))}</dt><dd class="mono">${esc(audit.completeness_score)} / ${esc(audit.scope_fit_score)} / ${esc(audit.quality_score)}</dd></div>
      <div><dt>${esc(t(lang, 'evidenceHash'))}</dt><dd class="mono">${esc(String(audit.evidence_hash || '').slice(0, 16))}…</dd></div>` : ''}
      ${bounty.settlement ? `<div><dt>${esc(t(lang, 'payout'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.settlement.hunter_payout_units || 0))}</dd></div>
      <div><dt>${esc(t(lang, 'refund'))}</dt><dd class="mono">${esc(fmtGenFromUnits(bounty.settlement.issuer_refund_units || 0))}</dd></div>` : ''}
      ${bounty.status === 'VERDICT_PENDING' ? `<div><dt>—</dt><dd>${esc(t(lang, 'pendingExecution'))}</dd></div>` : ''}
      ${bounty.challenge ? `<div><dt>—</dt><dd>${esc(t(lang, 'challengePending'))}</dd></div>` : ''}
    </dl>
    <div class="card-actions">${actions}</div>
  </article>`;
}

function actionButtons(bounty) {
  if (!wallet) return '';
  const me = wallet.address;
  const btns = [];
  const add = (action, label) => btns.push(
    `<button data-action="${action}" data-bounty="${esc(bounty.bounty_id)}">${esc(label)}</button>`);
  if (bounty.status === 'OPEN' && me !== (bounty.issuer || '').toLowerCase()) add('claim', t(lang, 'claim'));
  if (bounty.status === 'OPEN' && me === (bounty.issuer || '').toLowerCase()) add('cancel', t(lang, 'cancel'));
  if (bounty.status === 'CLAIMED' && me === (bounty.claimed_by || '').toLowerCase()) {
    add('submit', t(lang, 'submitDelivery'));
    add('abandon', t(lang, 'abandon'));
  }
  if (bounty.status === 'CLAIMED' && me === (bounty.issuer || '').toLowerCase()) add('release', t(lang, 'release'));
  if (bounty.status === 'DELIVERED' && me === (bounty.claimed_by || '').toLowerCase()) add('withdraw-delivery', t(lang, 'withdrawDelivery'));
  if (bounty.status === 'DELIVERED' && me === (bounty.issuer || '').toLowerCase()) add('evaluate', t(lang, 'evaluate'));
  if (bounty.status === 'VERDICT_PENDING' && me === (bounty.claimed_by || '').toLowerCase() && !bounty.challenge) add('challenge', t(lang, 'challenge'));
  if (bounty.status === 'VERDICT_PENDING' && me === (bounty.issuer || '').toLowerCase() && bounty.challenge) add('resolve', t(lang, 'resolveChallenge'));
  if (bounty.status === 'VERDICT_PENDING' && !bounty.challenge &&
      (me === (bounty.issuer || '').toLowerCase() || me === (bounty.claimed_by || '').toLowerCase())) add('execute', t(lang, 'execute'));
  return btns.join('');
}

function renderBoard() {
  const board = $('#kanban');
  if (!snapshot) {
    board.innerHTML = `<p class="empty">${esc(readingBack ? t(lang, 'readingBack') : t(lang, 'unconfirmed'))}</p>`;
    return;
  }
  const columns = { OPEN: [], CLAIMED: [], DELIVERED: [], VERDICT_PENDING: [], SETTLED: [] };
  for (const bounty of Object.values(snapshot.bounties)) {
    const status = bounty.status || 'OPEN';
    if (status === 'OPEN') columns.OPEN.push(bounty);
    else if (status === 'CLAIMED') columns.CLAIMED.push(bounty);
    else if (status === 'DELIVERED' || status === 'VERDICT_PENDING') columns[status === 'DELIVERED' ? 'DELIVERED' : 'VERDICT_PENDING'].push(bounty);
    else columns.SETTLED.push(bounty);
  }
  const col = (key, titleKey, list) => `<section class="kanban-col"><h3>${esc(t(lang, titleKey))} <span class="count">${list.length}</span></h3>${list.map(bountyCard).join('') || `<p class="empty">${esc(t(lang, 'empty'))}</p>`}</section>`;
  board.innerHTML =
    col('OPEN', 'colOpen', columns.OPEN) +
    col('CLAIMED', 'colClaimed', columns.CLAIMED) +
    col('REVIEW', 'colReview', [...columns.DELIVERED, ...columns.VERDICT_PENDING]) +
    col('SETTLED', 'colSettled', columns.SETTLED);
}

function renderLeaderboard() {
  const list = $('#leaderboard');
  if (!snapshot) {
    list.innerHTML = `<p class="empty">${esc(readingBack ? t(lang, 'readingBack') : t(lang, 'unconfirmed'))}</p>`;
    return;
  }
  const hunters = Object.values(snapshot.hunters)
    .sort((a, b) => (b.reputation - a.reputation) || (b.settled - a.settled));
  if (hunters.length === 0) {
    list.innerHTML = `<p class="empty">${esc(t(lang, 'leaderboardEmpty'))}</p>`;
    return;
  }
  list.innerHTML = hunters.map((h, i) => `<button class="hunter-row" data-hunter="${esc(h.address)}">
    <span class="rank">${i + 1}</span>
    <span class="hunter-id mono">${esc(shortAddr(h.address))}</span>
    <span class="rep">★ <span class="mono">${esc(h.reputation)}</span></span>
    <span class="mini">${esc(t(lang, 'settled'))} <span class="mono">${esc(h.settled)}</span></span>
  </button>`).join('');
}

function renderDossier() {
  const panel = $('#dossier');
  const bounty = selectedBountyId && snapshot ? snapshot.bounties[selectedBountyId] : null;
  const hunterAddr = selectedHunter || (bounty ? bounty.claimed_by : null);
  const hunter = hunterAddr && snapshot ? snapshot.hunters[hunterAddr.toLowerCase()] : null;
  if (!snapshot) {
    panel.innerHTML = `<h2>${esc(t(lang, 'dossier'))}</h2><p class="empty">${esc(t(lang, 'unconfirmed'))}</p>`;
    return;
  }
  let html = `<h2>${esc(t(lang, 'dossier'))}</h2>`;
  if (bounty) {
    html += `<h3>${esc(bounty.bounty_id)}</h3>${bountyCard(bounty)}`;
  }
  if (hunter) {
    html += `<dl class="hunter-stats">
      <div><dt>${esc(t(lang, 'reputation'))}</dt><dd class="mono">${esc(hunter.reputation)}</dd></div>
      <div><dt>${esc(t(lang, 'settled'))}</dt><dd class="mono">${esc(hunter.settled)}</dd></div>
      <div><dt>${esc(t(lang, 'accepted'))}</dt><dd class="mono">${esc(hunter.accepted)}</dd></div>
      <div><dt>${esc(t(lang, 'partial'))}</dt><dd class="mono">${esc(hunter.partial)}</dd></div>
      <div><dt>${esc(t(lang, 'rejected'))}</dt><dd class="mono">${esc(hunter.rejected)}</dd></div>
      <div><dt>${esc(t(lang, 'fake'))}</dt><dd class="mono">${esc(hunter.fake)}</dd></div>
    </dl>`;
  }
  if (!bounty && !hunter) html += `<p class="empty">${esc(t(lang, 'selectHunter'))}</p>`;
  // Export: only from a FINALIZED readback with a settled last_audit.
  const canExport = Boolean(bounty && bounty.last_audit);
  html += `<button id="export-btn" ${canExport ? '' : 'disabled'}>${esc(t(lang, 'exportDossier'))}</button>`;
  if (!canExport) html += `<p class="hint">${esc(t(lang, 'exportUnavailable'))}</p>`;
  // Withdrawable balance of the connected wallet (readback only).
  if (wallet) {
    html += `<div class="withdraw-box"><span>${esc(t(lang, 'withdrawable'))}</span>
      <button id="withdraw-btn">${esc(t(lang, 'withdraw'))}</button></div>`;
  }
  panel.innerHTML = html;
  const exportBtn = $('#export-btn');
  if (exportBtn && canExport) exportBtn.onclick = exportDossier;
  const withdrawBtn = $('#withdraw-btn');
  if (withdrawBtn) withdrawBtn.onclick = async () => {
    await runWrite(t(lang, 'withdraw'), 'withdraw', []);
  };
}

async function exportDossier() {
  if (!snapshot || !selectedBountyId) return;
  const bounty = snapshot.bounties[selectedBountyId];
  if (!bounty) return;
  const hunter = bounty.claimed_by ? snapshot.hunters[bounty.claimed_by.toLowerCase()] : null;
  const result = buildDossier({ bounty, hunter, totals: snapshot.totals, readBackAt: snapshot.readBackAt });
  if (!result.ok) {
    setNotice(`${t(lang, 'exportUnavailable')} (${result.reason})`, 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(result.dossier, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dossier-${bounty.bounty_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderStatus() {
  const el = $('#readback-status');
  el.textContent = snapshot
    ? `${t(lang, 'readBackOk')} · ${snapshot.readBackAt}`
    : (readingBack ? t(lang, 'readingBack') : t(lang, 'unconfirmed'));
  const totals = $('#ledger');
  if (!snapshot) {
    totals.innerHTML = `<span>${esc(t(lang, 'ledger'))}: ${esc(t(lang, 'unconfirmed'))}</span>`;
    return;
  }
  const tot = snapshot.totals;
  totals.innerHTML = `<span>${esc(t(lang, 'totalReceived'))} <b class="mono">${esc(fmtGenFromWei(tot.total_received_wei))}</b></span>
    <span>${esc(t(lang, 'totalWithdrawn'))} <b class="mono">${esc(fmtGenFromWei(tot.total_withdrawn_wei))}</b></span>
    <span>${esc(t(lang, 'escrowed'))} <b class="mono">${esc(fmtGenFromWei(tot.escrowed_wei))}</b></span>`;
}

function renderWallet() {
  const el = $('#wallet-state');
  if (!wallet) {
    el.innerHTML = `<button id="connect-btn">${esc(t(lang, 'connectWallet'))}</button>
      <button id="temp-btn">${esc(t(lang, 'tempAccount'))}</button>`;
    $('#connect-btn').onclick = connectInjected;
    $('#temp-btn').onclick = useTempAccount;
  } else {
    el.innerHTML = `<span class="wallet-label">${esc(wallet.label)}</span>
      <button id="disconnect-btn">${esc(t(lang, 'disconnect'))}</button>`;
    $('#disconnect-btn').onclick = disconnectWallet;
    if (wallet.kind === 'temp') {
      el.insertAdjacentHTML('beforeend', `<p class="hint">${esc(t(lang, 'tempAccountNote'))}</p>`);
    }
  }
}

function renderStaticText() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });
  $('#lang-toggle').textContent = lang === 'zh' ? 'EN' : '中文';
}

function renderAll() {
  renderStaticText();
  renderStatus();
  const apply = () => { renderBoard(); renderLeaderboard(); renderDossier(); renderWallet(); };
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}

function setNotice(message, kind) {
  const el = $('#notice');
  el.textContent = message;
  el.dataset.kind = kind || 'info';
}

// ------------------------------------------------------------------
// Forms.
// ------------------------------------------------------------------
function bindForms() {
  $('#lang-toggle').onclick = () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('bb-lang', lang);
    renderAll();
  };
  $('#refresh-btn').onclick = refreshSnapshot;
  $('#post-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const amountUnits = Number($('#post-amount').value);
    const valueWei = BigInt(amountUnits) * APP_CONFIG.WEI_PER_UNIT;
    await runWrite(t(lang, 'postBounty'), 'post_bounty', [
      $('#post-id').value.trim(),
      amountUnits,
      Number($('#post-minrep').value),
      $('#post-repo').value.trim().toLowerCase(),
      $('#post-req').value.trim(),
    ], valueWei);
  });
  document.addEventListener('click', async (event) => {
    const card = event.target.closest('.bounty-card');
    if (card && !event.target.closest('button')) {
      selectedBountyId = card.dataset.bounty;
      selectedHunter = null;
      renderDossier();
      return;
    }
    const row = event.target.closest('.hunter-row');
    if (row) {
      selectedHunter = row.dataset.hunter;
      selectedBountyId = null;
      renderDossier();
      return;
    }
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const bountyId = btn.dataset.bounty;
    const bounty = snapshot?.bounties[bountyId];
    if (!bounty) return;
    const action = btn.dataset.action;
    if (action === 'claim') {
      const login = window.prompt(t(lang, 'hunterLogin'));
      if (!login) return;
      const stake = Math.min(10000, Math.max(1000, Math.floor(bounty.amount / 10)));
      await runWrite(t(lang, 'claim'), 'claim_bounty', [bountyId, login.trim().toLowerCase()],
        BigInt(stake) * APP_CONFIG.WEI_PER_UNIT);
    } else if (action === 'submit') {
      const prUrl = window.prompt(t(lang, 'prLink'));
      if (!prUrl) return;
      const notePath = window.prompt(t(lang, 'notePath'), 'deliveries/' + bountyId + '.md');
      if (notePath === null) return;
      const noteText = window.prompt(t(lang, 'noteText'), '');
      if (noteText === null) return;
      await runWrite(t(lang, 'submitDelivery'), 'submit_delivery',
        [bountyId, prUrl.trim(), notePath.trim(), noteText]);
    } else if (action === 'evaluate') {
      await runWrite(t(lang, 'evaluate'), 'evaluate_delivery', [bountyId]);
    } else if (action === 'execute') {
      await runWrite(t(lang, 'execute'), 'execute_verdict', [bountyId]);
    } else if (action === 'cancel') {
      await runWrite(t(lang, 'cancel'), 'cancel_bounty', [bountyId]);
    } else if (action === 'abandon') {
      await runWrite(t(lang, 'abandon'), 'abandon_claim', [bountyId]);
    } else if (action === 'release') {
      await runWrite(t(lang, 'release'), 'release_claim', [bountyId]);
    } else if (action === 'withdraw-delivery') {
      await runWrite(t(lang, 'withdrawDelivery'), 'withdraw_delivery', [bountyId]);
    } else if (action === 'challenge') {
      const newPrUrl = window.prompt(t(lang, 'newPrUrl'));
      if (!newPrUrl) return;
      const reason = window.prompt(t(lang, 'challengeReason'));
      if (!reason) return;
      const claimed = window.prompt(t(lang, 'claimedVerdict') + ' (ACCEPT/PARTIAL/REJECT)');
      if (!claimed) return;
      await runWrite(t(lang, 'challenge'), 'challenge_verdict',
        [bountyId, newPrUrl.trim(), reason, claimed.trim().toUpperCase()]);
    } else if (action === 'resolve') {
      await runWrite(t(lang, 'resolveChallenge'), 'resolve_challenge', [bountyId]);
    }
  });
}

bindForms();
renderAll();
refreshSnapshot();
