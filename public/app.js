import { createExecutionLock, createWalletContextGuard, formatUnits, isQuoteExecutable, shortAddress, shouldCompactNav, toRpcTransaction, walletConnectionGuidance } from './logic.js';
import { createJournalEntry, loadJournal, mergeJournalEntry, saveJournal, updateJournalReceipt } from './journal.js';
import {
  connectWalletConnector,
  getWalletConnectState,
  listWalletConnectors,
  reconnectWalletConnector,
  watchWalletConnectors,
} from './wallet-runtime.js';

const els = Object.fromEntries([
  'networkState','connectButton','quoteForm','amount','slippage','quoteButton','balanceText','expectedOut',
  'quoteSource','inlineStatus','txState','emptyReview','reviewContent','reviewExpected','reviewMinimum',
  'reviewRecipient','reviewValue','reviewGas','reviewBlock','reviewDeadline','reviewCalldata','routerLink','quoteExpiry',
  'reviewCheck','executeButton','receiptLink','walletDialog','walletDialogTitle','walletDialogMessage','walletOptions',
  'walletSetupNote','walletConnectState','closeWalletDialog','journalCoverage','exportJournalButton','journalEmpty','journalList',
].map((id) => [id, document.getElementById(id)]));

const state = { provider: null, connector: null, account: null, chainId: null, quote: null, activeTx: null, quoteRequest: 0, journal: loadJournal() };
const executionLock = createExecutionLock();
const walletContextGuard = createWalletContextGuard();
const boundProviders = new WeakSet();
const CHAIN = { id: 4663, hex: '0x1237', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' };

function setStatus(message, type = '') {
  els.inlineStatus.textContent = message;
  els.inlineStatus.className = `inline-status ${type}`;
}

function setTxState(value) {
  els.txState.textContent = value.replaceAll('_', ' ').toUpperCase();
  els.txState.className = `state-badge ${value === 'confirmed' ? 'confirmed' : value === 'pending' || value === 'awaiting_signature' ? 'pending' : ['reverted','unknown','simulation_failed','signature_rejected','quote_expired'].includes(value) ? 'failed' : ''}`;
}

function clearQuote(reason = 'Request a fresh simulation.') {
  state.quoteRequest += 1;
  state.quote = null;
  els.emptyReview.classList.remove('hidden');
  els.reviewContent.classList.add('hidden');
  els.expectedOut.textContent = '—';
  els.reviewCheck.checked = false;
  els.executeButton.disabled = true;
  if (!state.activeTx) {
    setTxState('draft');
    setStatus(reason);
  } else {
    setStatus(`Transaction ${shortAddress(state.activeTx.hash)} remains ${state.activeTx.status}. Wallet context changed, settlement tracking continues.`);
  }
}

function updateQuoteButton() {
  const ready = Boolean(state.provider && state.account && state.chainId === CHAIN.id);
  els.quoteButton.disabled = !ready;
  els.quoteButton.textContent = ready ? 'Simulate exact trade' : state.account ? 'Switch to Robinhood Chain' : 'Connect wallet to simulate';
}

async function refreshBalance() {
  if (!state.provider || !state.account) return;
  try {
    const raw = await state.provider.request({ method: 'eth_getBalance', params: [state.account, 'latest'] });
    els.balanceText.textContent = `Balance ${formatUnits(BigInt(raw).toString(), 18, 5)} ETH`;
  } catch { els.balanceText.textContent = 'Balance unavailable'; }
}

async function ensureChain() {
  const current = await state.provider.request({ method: 'eth_chainId' });
  if (Number(BigInt(current)) !== CHAIN.id) {
    try {
      await state.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await state.provider.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: CHAIN.hex,
        chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [CHAIN.rpc],
        blockExplorerUrls: [CHAIN.explorer],
      }] });
    }
  }
  state.chainId = Number(BigInt(await state.provider.request({ method: 'eth_chainId' })));
  updateQuoteButton();
}

function bindProvider(provider) {
  if (!provider?.on || boundProviders.has(provider)) return;
  boundProviders.add(provider);
  provider.on('accountsChanged', (accounts) => {
    walletContextGuard.invalidate();
    state.account = accounts?.[0] || null;
    els.connectButton.textContent = state.account ? shortAddress(state.account) : 'Connect wallet';
    clearQuote('Account changed. Request a fresh simulation.');
    updateQuoteButton();
    refreshBalance();
  });
  provider.on('chainChanged', (chainHex) => {
    walletContextGuard.invalidate();
    state.chainId = Number(BigInt(chainHex));
    clearQuote('Network changed. Request a fresh simulation.');
    updateQuoteButton();
  });
  provider.on('disconnect', () => {
    walletContextGuard.invalidate();
    state.account = null; state.chainId = null; state.provider = null; state.connector = null;
    els.connectButton.textContent = 'Connect wallet';
    clearQuote('Wallet disconnected.'); updateQuoteButton();
  });
}

function showWalletDialog() {
  if (typeof els.walletDialog.showModal === 'function') {
    if (!els.walletDialog.open) els.walletDialog.showModal();
  } else {
    els.walletDialog.setAttribute('open', '');
  }
  const target = els.walletOptions.querySelector('button:not([disabled])') || els.closeWalletDialog;
  target.focus();
}

function closeWalletDialog() {
  if (typeof els.walletDialog.close === 'function') els.walletDialog.close();
  else els.walletDialog.removeAttribute('open');
}

function renderWalletOptions(options) {
  els.walletOptions.replaceChildren();
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wallet-option';
    button.dataset.connectorUid = option.uid;
    const name = document.createElement('strong');
    name.textContent = option.name;
    const method = document.createElement('span');
    method.textContent = option.id === 'walletConnect' ? 'QR / mobile' : 'Browser wallet';
    button.append(name, method);
    els.walletOptions.append(button);
  }
}

async function openWalletChooser() {
  els.connectButton.disabled = true;
  els.connectButton.textContent = 'Detecting wallets…';
  setStatus('Discovering available wallet connectors.');
  els.walletDialogTitle.textContent = 'Choose a wallet';
  els.walletDialogMessage.textContent = 'Select a wallet. Connecting does not authorize a transaction.';
  try {
    const options = await listWalletConnectors();
    renderWalletOptions(options);
    const wc = getWalletConnectState();
    els.walletConnectState.textContent = wc.configured
      ? 'Available for QR pairing and supported mobile wallet deep links.'
      : `${wc.message} Injected Rabby, MetaMask, and compatible browser wallets remain available.`;
    els.walletSetupNote.classList.toggle('hidden', wc.configured && options.length > 0);
    if (options.length === 0) {
      els.walletDialogTitle.textContent = 'No wallet detected';
      els.walletDialogMessage.textContent = wc.configured
        ? 'No injected wallet was detected. Use WalletConnect when it becomes available in the list.'
        : 'Open Verity in a Rabby or MetaMask browser, or install an EIP-6963 compatible desktop extension.';
      setStatus('No compatible wallet connector is currently available.', 'error');
    } else {
      setStatus(options.length > 1 ? 'Wallet selection required.' : 'Wallet detected. Select it to continue.');
    }
    showWalletDialog();
  } catch (error) {
    const message = walletConnectionGuidance(error);
    els.walletDialogTitle.textContent = 'Wallet discovery failed';
    els.walletDialogMessage.textContent = message;
    renderWalletOptions([]);
    els.walletConnectState.textContent = getWalletConnectState().message;
    setStatus(message, 'error');
    showWalletDialog();
  } finally {
    els.connectButton.disabled = false;
    els.connectButton.textContent = state.account ? shortAddress(state.account) : 'Connect wallet';
  }
}

async function connectWallet(uid) {
  const buttons = [...els.walletOptions.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  els.walletDialogMessage.textContent = 'Connection requested. Continue in your selected wallet.';
  setStatus('Connection requested. Review the wallet prompt.');
  try {
    const connection = await connectWalletConnector(uid);
    walletContextGuard.invalidate();
    state.provider = connection.provider;
    state.connector = connection.connector;
    state.account = connection.account;
    state.chainId = connection.chainId;
    bindProvider(connection.provider);
    await ensureChain();
    els.connectButton.textContent = shortAddress(state.account);
    await refreshBalance();
    closeWalletDialog();
    setStatus(`${connection.connector.name} connected. Request a live simulation.`);
  } catch (error) {
    const message = walletConnectionGuidance(error);
    els.walletDialogMessage.textContent = message;
    setStatus(message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function restoreWalletConnection() {
  try {
    const connection = await reconnectWalletConnector();
    if (!connection) return;
    walletContextGuard.invalidate();
    state.provider = connection.provider;
    state.connector = connection.connector;
    state.account = connection.account;
    state.chainId = connection.chainId;
    bindProvider(connection.provider);
    els.connectButton.textContent = shortAddress(state.account);
    updateQuoteButton();
    await refreshBalance();
    setStatus(`${connection.connector.name} reconnected. Request a fresh simulation.`);
  } catch {
    setStatus('Saved wallet session could not be restored. Connect again.', 'error');
  }
}

function renderQuote(quote) {
  state.quote = quote;
  const expected = `${formatUnits(quote.expectedOut, 6, 6)} USDG`;
  const minimum = `${formatUnits(quote.minimumOut, 6, 6)} USDG`;
  els.expectedOut.textContent = formatUnits(quote.expectedOut, 6, 6);
  const providerLabel = quote.providerClass === 'public_rpc' ? 'rate-limited public RPC' : quote.providerClass === 'authenticated_rpc' ? 'authenticated RPC' : 'custom RPC';
  els.quoteSource.textContent = `On-chain simulation · block ${quote.simulatedAtBlock?.toLocaleString() || 'unknown'} · ${providerLabel}`;
  els.reviewExpected.textContent = expected;
  els.reviewMinimum.textContent = minimum;
  els.reviewRecipient.textContent = shortAddress(quote.from);
  els.reviewValue.textContent = `${formatUnits(quote.value, 18, 6)} ETH`;
  els.reviewGas.textContent = Number(quote.gasEstimate).toLocaleString();
  els.reviewBlock.textContent = quote.simulatedAtBlock?.toLocaleString() || 'Unknown';
  els.reviewDeadline.textContent = new Date(quote.deadline * 1000).toISOString().slice(11, 19) + ' UTC';
  els.reviewCalldata.textContent = quote.data;
  els.routerLink.textContent = shortAddress(quote.to);
  els.routerLink.href = `${CHAIN.explorer}/address/${quote.to}`;
  els.emptyReview.classList.add('hidden');
  els.reviewContent.classList.remove('hidden');
  els.reviewCheck.checked = false;
  setTxState('quoted');
  setStatus('Simulation passed. Review the exact transaction before signing.');
  updateExpiry();
}

function updateExpiry() {
  if (!state.quote) return;
  const remaining = Math.max(0, Math.ceil((state.quote.expiresAt - Date.now()) / 1000));
  els.quoteExpiry.textContent = remaining ? `${remaining}s` : 'Expired';
  const executable = isQuoteExecutable(state.quote, { account: state.account, chainId: state.chainId, now: Date.now() });
  els.executeButton.disabled = !(executable && els.reviewCheck.checked);
  els.executeButton.textContent = executable ? (els.reviewCheck.checked ? 'Sign & execute in wallet' : 'Review before signing') : 'Quote expired — simulate again';
  if (!executable && remaining === 0) setTxState('quote_expired');
}

async function requestQuote(event) {
  event.preventDefault();
  if (!state.account || state.chainId !== CHAIN.id) return connectWallet();
  const requestId = ++state.quoteRequest;
  const requestAccount = state.account;
  const requestChain = state.chainId;
  const requestProvider = state.provider;
  els.quoteButton.disabled = true;
  els.quoteButton.textContent = 'Simulating on-chain…';
  setTxState('draft');
  setStatus('Calling the pinned router at the latest available chain state.');
  try {
    const response = await fetch('/api/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ wallet: state.account, amount: els.amount.value, slippageBps: Number(els.slippage.value) }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'quote_unavailable');
    if (requestId !== state.quoteRequest
      || requestAccount?.toLowerCase() !== state.account?.toLowerCase()
      || requestChain !== state.chainId
      || requestProvider !== state.provider) {
      throw new Error('wallet_context_changed');
    }
    renderQuote(body);
  } catch (error) {
    state.quote = null; setTxState('simulation_failed');
    setStatus(error.message === 'provider_unavailable' ? 'RPC provider unavailable. No transaction was prepared.' : 'Simulation failed. No transaction was prepared.', 'error');
  } finally { updateQuoteButton(); }
}

function journalElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatJournalAmount(value, decimals) {
  try { return formatUnits(String(value), decimals, 6); }
  catch { return 'Unknown'; }
}

function renderJournal() {
  els.journalList.replaceChildren();
  const entries = state.journal;
  els.journalCoverage.textContent = entries.length
    ? `${entries.length} locally recorded execution${entries.length === 1 ? '' : 's'} · browser-local coverage`
    : 'No locally recorded executions';
  els.exportJournalButton.disabled = entries.length === 0;
  els.journalEmpty.classList.toggle('hidden', entries.length > 0);
  els.journalList.classList.toggle('hidden', entries.length === 0);

  for (const entry of entries) {
    const article = journalElement('article', 'journal-entry');
    const head = journalElement('div', 'journal-entry-head');
    const label = journalElement('p', 'label', entry.pair || 'ETH/USDG');
    const link = journalElement('a', '', shortAddress(entry.hash));
    link.href = `/receipt.html?hash=${encodeURIComponent(entry.hash)}`;
    link.setAttribute('aria-label', `Open execution receipt ${entry.hash}`);
    const badge = journalElement('span', `state-badge journal-entry-state ${entry.status === 'confirmed' ? 'confirmed' : entry.status === 'pending' ? 'pending' : 'failed'}`, String(entry.status || 'unknown').toUpperCase());
    const when = journalElement('span', '', new Date(Number(entry.broadcastAt)).toLocaleString());
    head.append(label, link, badge, when);

    const evidence = journalElement('dl', 'journal-evidence');
    const fields = [
      ['Input', `${formatJournalAmount(entry.input, 18)} ETH`],
      ['Expected', `${formatJournalAmount(entry.expectedOut, 6)} USDG`],
      ['Minimum', `${formatJournalAmount(entry.minimumOut, 6)} USDG`],
      ['Simulated block', Number.isInteger(entry.simulatedAtBlock) ? entry.simulatedAtBlock.toLocaleString() : 'Unknown'],
      ['Receipt block', Number.isInteger(entry.receiptBlock) ? entry.receiptBlock.toLocaleString() : 'Not settled'],
      ['Provider', entry.providerClass || 'unknown'],
    ];
    for (const [name, value] of fields) {
      const row = document.createElement('div');
      row.append(journalElement('dt', '', name), journalElement('dd', '', value));
      evidence.append(row);
    }
    article.append(head, evidence);
    els.journalList.append(article);
  }
}

function persistJournalBroadcast(hash, quote, broadcastAt) {
  try {
    const entry = createJournalEntry({ hash, quote, now: broadcastAt });
    state.journal = mergeJournalEntry(state.journal, entry);
    saveJournal(state.journal);
    renderJournal();
  } catch {
    setStatus('Transaction broadcast, but its local evidence journal could not be created. Receipt tracking continues.', 'error');
  }
}

function persistJournalReceipt(hash, receipt) {
  const current = state.journal.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
  if (!current) return;
  state.journal = mergeJournalEntry(state.journal, updateJournalReceipt(current, receipt));
  saveJournal(state.journal);
  renderJournal();
}

function exportJournal() {
  const payload = {
    schema: 'verity.execution-journal.v1',
    coverage: 'browser_local_only',
    chainId: CHAIN.id,
    exportedAt: new Date().toISOString(),
    entries: state.journal,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `verity-execution-journal-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function pollReceipt(transaction, evidenceQuote = null) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (state.activeTx?.hash !== transaction.hash) return;
    try {
      const response = await fetch(`/api/receipt?hash=${encodeURIComponent(transaction.hash)}`, { cache: 'no-store' });
      const receipt = await response.json();
      if (!response.ok || receipt.status === 'pending') continue;
      if (receipt.status === 'confirmed') {
        setTxState('confirmed');
        setStatus(`Receipt confirmed in Robinhood Chain block ${receipt.blockNumber.toLocaleString()}. This is not an L1-finality claim.`);
        await refreshBalance();
      } else if (receipt.status === 'reverted') {
        setTxState('reverted');
        setStatus('Transaction reverted. Review the explorer receipt.', 'error');
      } else {
        setTxState('unknown');
        setStatus('Receipt status is unknown. The hash is not treated as success.', 'error');
      }
      if (evidenceQuote && ['confirmed', 'reverted'].includes(receipt.status)
        && !state.journal.some((entry) => entry.hash.toLowerCase() === transaction.hash.toLowerCase())) {
        persistJournalBroadcast(transaction.hash, evidenceQuote, transaction.broadcastAt);
      }
      persistJournalReceipt(transaction.hash, receipt);
      state.activeTx = null;
      try { localStorage.removeItem('verity.activeTx'); } catch { /* storage is best-effort */ }
      return;
    } catch { /* keep reconciling through the chain-pinned receipt API */ }
  }
  if (state.activeTx?.hash === transaction.hash) {
    state.activeTx.status = 'unknown';
    try { localStorage.setItem('verity.activeTx', JSON.stringify(state.activeTx)); } catch { /* storage is best-effort */ }
    setTxState('unknown');
    setStatus('Receipt is still unknown. The hash is preserved and is not treated as success.', 'error');
    persistJournalReceipt(transaction.hash, { status: 'unknown', blockNumber: null });
  }
}

function persistActiveTransaction(transaction) {
  state.activeTx = transaction;
  els.receiptLink.href = `${CHAIN.explorer}/tx/${transaction.hash}`;
  els.receiptLink.classList.remove('hidden');
  try { localStorage.setItem('verity.activeTx', JSON.stringify(transaction)); } catch { /* in-memory tracking continues */ }
}

async function executeQuote() {
  const result = await executionLock.run(async () => {
    const quote = state.quote;
    const provider = state.provider;
    const account = state.account;
    const chainId = state.chainId;
    if (!isQuoteExecutable(quote, { account, chainId, now: Date.now() }) || !els.reviewCheck.checked) {
      updateExpiry();
      return;
    }
    els.executeButton.disabled = true;
    els.executeButton.textContent = 'Wallet confirmation pending…';
    try {
      await ensureChain();
      if (provider !== state.provider
        || account?.toLowerCase() !== state.account?.toLowerCase()
        || chainId !== state.chainId
        || !isQuoteExecutable(quote, { account: state.account, chainId: state.chainId, now: Date.now() })) {
        setTxState('quote_expired');
        setStatus('Wallet context or quote freshness changed. Simulate again.', 'error');
        return;
      }
      const signatureContext = walletContextGuard.snapshot();
      setTxState('awaiting_signature');
      setStatus('Review the wallet prompt. Verity cannot sign for you.');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [toRpcTransaction(quote, CHAIN.id)] });
      if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) throw new Error('transaction_hash_invalid');
      const contextStable = walletContextGuard.isCurrent(signatureContext)
        && provider === state.provider
        && account?.toLowerCase() === state.account?.toLowerCase()
        && state.chainId === CHAIN.id;
      const transaction = {
        hash,
        chainId: CHAIN.id,
        status: contextStable ? 'pending' : 'unknown',
        broadcastAt: Date.now(),
        walletContextChanged: !contextStable,
      };
      persistActiveTransaction(transaction);
      if (contextStable) persistJournalBroadcast(hash, quote, transaction.broadcastAt);
      state.quote = null;
      if (contextStable) {
        setTxState('pending');
        setStatus('Transaction broadcast. Waiting for a chain-pinned receipt—not assuming success.');
      } else {
        setTxState('unknown');
        setStatus('A hash returned after the wallet context changed. Chain 4663 settlement is unverified; checking the pinned receipt endpoint.', 'error');
      }
      pollReceipt(transaction, contextStable ? null : quote);
    } catch (error) {
      setTxState(error?.code === 4001 ? 'signature_rejected' : 'unknown');
      setStatus(error?.code === 4001 ? 'Signature rejected. Nothing was broadcast.' : 'Wallet submission failed or is unknown. Check your wallet activity.', 'error');
    } finally {
      if (!state.activeTx) updateExpiry();
    }
  });
  if (result === null) setStatus('A wallet submission is already in progress. Duplicate request blocked.', 'error');
}

function restoreActiveTransaction() {
  try {
    const saved = JSON.parse(localStorage.getItem('verity.activeTx') || 'null');
    if (!saved
      || saved.chainId !== CHAIN.id
      || !/^0x[0-9a-f]{64}$/i.test(saved.hash || '')
      || !['pending', 'unknown'].includes(saved.status)) return;
    persistActiveTransaction(saved);
    setTxState(saved.status);
    setStatus(`Restored ${saved.status} transaction ${shortAddress(saved.hash)}. Chain-pinned receipt reconciliation continues.`);
    pollReceipt(saved);
  } catch {
    try { localStorage.removeItem('verity.activeTx'); } catch { /* storage unavailable */ }
  }
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error('degraded');
    els.networkState.className = 'network-state live';
    const source = body.provider?.source === 'public_rpc' ? 'public RPC' : body.provider?.source === 'authenticated_rpc' ? 'authenticated RPC' : 'custom RPC';
    els.networkState.querySelector('span:last-child').textContent = `Live · ${source} · block ${body.blockNumber.toLocaleString()}`;
  } catch {
    els.networkState.className = 'network-state error';
    els.networkState.querySelector('span:last-child').textContent = 'Provider unavailable';
  }
}

const floatingNav = document.getElementById('floatingNav');
let navCompact = shouldCompactNav(false, window.scrollY);
let navFrame = 0;
floatingNav?.classList.toggle('is-scrolled', navCompact);
window.addEventListener('scroll', () => {
  if (navFrame) return;
  navFrame = window.requestAnimationFrame(() => {
    navFrame = 0;
    const next = shouldCompactNav(navCompact, window.scrollY);
    if (next === navCompact) return;
    navCompact = next;
    floatingNav?.classList.toggle('is-scrolled', navCompact);
  });
}, { passive: true });

els.closeWalletDialog.addEventListener('click', closeWalletDialog);
els.walletDialog.addEventListener('click', (event) => {
  if (event.target === els.walletDialog) closeWalletDialog();
});
els.walletOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-connector-uid]');
  if (button) connectWallet(button.dataset.connectorUid);
});
els.connectButton.addEventListener('click', openWalletChooser);
watchWalletConnectors((options) => {
  if (els.walletDialog.open) renderWalletOptions(options);
});
els.quoteForm.addEventListener('submit', requestQuote);
els.reviewCheck.addEventListener('change', updateExpiry);
els.executeButton.addEventListener('click', executeQuote);
els.exportJournalButton.addEventListener('click', exportJournal);
setInterval(updateExpiry, 1000);
setInterval(checkHealth, 30_000);
restoreActiveTransaction();
renderJournal();
checkHealth();
updateQuoteButton();
restoreWalletConnection();
