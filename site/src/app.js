import { decodeWriteReturn } from './write-result.js';
import { verdictActions } from './deadlines.js';
import { stakeForUnits, formatWeiAsGen } from './amounts.js';
import { writeAsDisplayed, fundTemporary, genToUnits, bindThenClaim } from './wallet-write.js';
// Bounty Board v2 — frontend.
// Display rule: every displayed or exported value comes from a
// FINALIZED get_* readback snapshot. Before a readback, fields show
// "unconfirmed". No seed data, no local simulation feeds any display,
// export, score, or payout field.
import { createAccount, abi } from 'genlayer-js';
import { encodeFunctionData } from 'viem';
import { studionet } from 'genlayer-js/chains';
import { APP_CONFIG } from './config.js';
import { STRINGS, t } from './i18n.js';
import { buildDossier, buildHunterDossier } from './dossier.js';
import { renderKanban, bountyCard } from './kanban.js';

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
    } catch (error) {
      if (method === 'eth_sendRawTransaction' || method === 'sim_fundAccount') throw error;
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    if (!res.ok) {
      if (method === 'eth_sendRawTransaction' || method === 'sim_fundAccount') throw Error('BROADCAST_UNCERTAIN');
      await sleep(Math.min(5000 * (attempt + 1), 30000));
      continue;
    }
    let body;
    try {
      body = await res.json();
    } catch (error) {
      if (method === 'eth_sendRawTransaction' || method === 'sim_fundAccount') throw Error('BROADCAST_UNCERTAIN');
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
// Chain writes use the selected displayed account.
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
  if (!APP_CONFIG.REMEDIATED_DEPLOYMENT) throw Error('NEW_CONTRACT_DEPLOYMENT_REQUIRED');
  const selected = wallet;
  if (!selected) throw Error('CONNECT_WALLET');
  const data = transactions.serialize([
    calldata.encode(calldata.makeCalldataObject(method, args, {})), false]);
  return writeAsDisplayed({ wallet: selected, tempAccount, rpc: rpcCall,
    chainId: APP_CONFIG.CHAIN_ID, to: chain.consensusMainContract.address,
    data: envelope(selected.address, APP_CONFIG.CONTRACT_ADDRESS, data), value: valueWei,
    currentWallet: () => wallet });
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
  let operation;
  try { operation = decodeWriteReturn(leader?.result); }
  catch (error) {
    setNotice(`${t(lang, 'txError')} (${error.message})`, 'error');
    await refreshSnapshot();
    return null;
  }
  if (!operation.accepted) {
    setNotice(`${t(lang, 'txFailed')}: ${operation.reason}; ${String(hash)}`, 'error');
    await refreshSnapshot();
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
      kind: 'injected', provider,
      address: (accounts[0] || '').toLowerCase(),
      label: `${window.okxwallet ? 'OKX Wallet' : 'Injected EVM Wallet'} ${(accounts[0] || '').slice(0, 6)}…${(accounts[0] || '').slice(-4)}`,
    };
    provider.on?.('accountsChanged', disconnectWallet);
    provider.on?.('chainChanged', disconnectWallet);
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
  return `${formatWeiAsGen(wei)} ${t(lang, 'genUnit')}`;
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
function renderBoard() {
  const board = $('#kanban');
  if (!snapshot) {
    board.innerHTML = `<p class="empty">${esc(readingBack ? t(lang, 'readingBack') : t(lang, 'unconfirmed'))}</p>`;
    return;
  }
  board.innerHTML = renderKanban(
    snapshot.bounties,
    (key) => t(lang, key),
    (bounty) => actionButtons(bounty),
  );
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
  const policy = verdictActions(bounty, Date.now() / 1000,
    me === (bounty.claimed_by || '').toLowerCase());
  if (policy.evaluate) add('evaluate', t(lang, 'evaluate'));
  if (policy.challenge) add('challenge', t(lang, 'challenge'));
  if (policy.resolve) add('resolve', t(lang, 'resolveChallenge'));
  if (policy.execute) add('execute', t(lang, 'execute'));
  return btns.join('');
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
    html += `<h3>${esc(bounty.bounty_id)}</h3>${bountyCard(bounty, (key) => t(lang, key), actionButtons(bounty))}`;
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
  // Export: wired to the FINALIZED readback. The button is enabled whenever
  // the panel shows readback content that can be exported — a settled bounty
  // (its audit) or a hunter record. Before any readback it stays disabled
  // with the honest "not read back yet" caption; after a readback the caption
  // never claims no readback happened. (A rendered snapshot always carries
  // the hunter record for every claimed bounty, so `hunter` being set is
  // the gate; the bounty path additionally needs a settled last_audit.)
  const canExport = Boolean(snapshot && hunter);
  html += `<button id="export-btn" ${canExport ? '' : 'disabled'}>${esc(t(lang, 'exportDossier'))}</button>`;
  if (!canExport) {
    const hintKey = !snapshot ? 'exportUnavailable' : (bounty || hunter) ? 'exportNotSettled' : 'exportSelectFirst';
    html += `<p class="hint">${esc(t(lang, hintKey))}</p>`;
  }
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

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportDossier() {
  if (!snapshot) return;
  const bounty = selectedBountyId ? snapshot.bounties[selectedBountyId] : null;
  const hunterAddr = selectedHunter || (bounty ? bounty.claimed_by : null);
  const hunter = hunterAddr ? snapshot.hunters[hunterAddr.toLowerCase()] : null;
  // A settled bounty exports its own dossier (audit + settlement + hunter).
  if (bounty && bounty.last_audit && hunter) {
    const result = buildDossier({ bounty, hunter, totals: snapshot.totals, readBackAt: snapshot.readBackAt });
    if (!result.ok) {
      setNotice(`${t(lang, 'exportUnavailable')} (${result.reason})`, 'error');
      return;
    }
    downloadJson(`dossier-${bounty.bounty_id}.json`, result.dossier);
    return;
  }
  // Otherwise the panel shows a hunter record: export the hunter dossier
  // (hunter stats + that hunter's bounties with their audits + totals).
  if (hunter) {
    const result = buildHunterDossier({ hunter, bounties: snapshot.bounties, totals: snapshot.totals, readBackAt: snapshot.readBackAt });
    if (!result.ok) {
      setNotice(`${t(lang, 'exportUnavailable')} (${result.reason})`, 'error');
      return;
    }
    downloadJson(`dossier-hunter-${hunter.address.slice(0, 10)}.json`, result.dossier);
  }
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
      el.insertAdjacentHTML('beforeend', `<p class="hint">${esc(t(lang, 'tempAccountNote'))}</p><button id="fund-temp-btn">Fund displayed account (20 testnet GEN)</button>`);
      $('#fund-temp-btn').onclick = async () => {
        try {
          const result = await fundTemporary({ wallet, rpc: rpcCall, currentWallet: () => wallet });
          setNotice(`${result.address}: ${fmtGenFromWei(result.balance)} (faucet may settle later; check balance before spending)`, 'info');
        } catch (error) { setNotice(error.message, 'error'); }
      };
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
    let amountUnits;
    try { amountUnits = genToUnits($('#post-amount').value); }
    catch (error) { setNotice(error.message, 'error'); return; }
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
      const token = `bb:61999:${APP_CONFIG.CONTRACT_ADDRESS.toLowerCase()}:${bountyId}:${wallet.address}`;
      const login = window.prompt(t(lang, 'hunterLogin') + '\nProof token (repository identity file or GitHub bio):\n' + token);
      if (!login) return;
      const identityRepo = window.prompt('Identity proof repository (owner/repo); leave empty to use GitHub bio', APP_CONFIG.REPO_SLUG);
      if (identityRepo === null) return;
      const identitySha = identityRepo ? window.prompt('Commit SHA already merged to the repository default branch. File path: identity/' + wallet.address + '/' + bountyId + '.txt; file must contain only the proof token.') : '';
      if (identitySha === null) return;
      const stake = stakeForUnits(bounty.amount);
      try {
        await bindThenClaim({ wallet, currentWallet: () => wallet, runWrite,
          args: [bountyId, login.trim().toLowerCase(), identityRepo.trim(), identitySha.trim()],
          value: BigInt(stake) * APP_CONFIG.WEI_PER_UNIT });
      } catch (error) { setNotice(error.message, 'error'); }
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
