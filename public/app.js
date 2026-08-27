import { createExecutionLock, formatUnits, isQuoteExecutable, shortAddress, toRpcTransaction } from './logic.js';

const els = Object.fromEntries([
  'networkState','connectButton','quoteForm','amount','slippage','quoteButton','balanceText','expectedOut',
  'quoteSource','inlineStatus','txState','emptyReview','reviewContent','reviewExpected','reviewMinimum',
  'reviewRecipient','reviewValue','reviewGas','reviewBlock','reviewDeadline','reviewCalldata','routerLink','quoteExpiry',
  'reviewCheck','executeButton','receiptLink',
].map((id) => [id, document.getElementById(id)]));

const state = { providers: [], provider: null, account: null, chainId: null, quote: null, activeTx: null, quoteRequest: 0 };
const executionLock = createExecutionLock();
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
  if (!provider?.on) return;
  provider.on('accountsChanged', (accounts) => {
    state.account = accounts?.[0] || null;
    els.connectButton.textContent = shortAddress(state.account);
    clearQuote('Account changed. Request a fresh simulation.');
    updateQuoteButton();
    refreshBalance();
  });
  provider.on('chainChanged', (chainHex) => {
    state.chainId = Number(BigInt(chainHex));
    clearQuote('Network changed. Request a fresh simulation.');
    updateQuoteButton();
  });
  provider.on('disconnect', () => {
    state.account = null; state.chainId = null; state.provider = null;
    els.connectButton.textContent = 'Connect wallet';
    clearQuote('Wallet disconnected.'); updateQuoteButton();
  });
}

async function connectWallet() {
  try {
    const chosen = state.providers[0]?.provider || window.ethereum;
    if (!chosen) throw new Error('wallet_not_found');
    state.provider = chosen;
    bindProvider(chosen);
    const accounts = await chosen.request({ method: 'eth_requestAccounts' });
    state.account = accounts[0];
    await ensureChain();
    els.connectButton.textContent = shortAddress(state.account);
    await refreshBalance();
    setStatus('Wallet connected. Request a live simulation.');
  } catch (error) {
    setStatus(error?.code === 4001 ? 'Wallet connection rejected.' : 'Unable to connect a compatible wallet.', 'error');
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

async function pollReceipt(transaction) {
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
      setTxState('awaiting_signature');
      setStatus('Review the wallet prompt. Verity cannot sign for you.');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [toRpcTransaction(quote)] });
      if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) throw new Error('transaction_hash_invalid');
      const transaction = { hash, chainId: CHAIN.id, status: 'pending', broadcastAt: Date.now() };
      persistActiveTransaction(transaction);
      state.quote = null;
      setTxState('pending');
      setStatus('Transaction broadcast. Waiting for a chain-pinned receipt—not assuming success.');
      pollReceipt(transaction);
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

window.addEventListener('eip6963:announceProvider', (event) => {
  if (!state.providers.some((item) => item.info.uuid === event.detail.info.uuid)) state.providers.push(event.detail);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
if (window.ethereum) state.providers.push({ info: { uuid: 'legacy', name: 'Browser wallet' }, provider: window.ethereum });

els.connectButton.addEventListener('click', connectWallet);
els.quoteForm.addEventListener('submit', requestQuote);
els.reviewCheck.addEventListener('change', updateExpiry);
els.executeButton.addEventListener('click', executeQuote);
setInterval(updateExpiry, 1000);
setInterval(checkHealth, 30_000);
restoreActiveTransaction();
checkHealth();
updateQuoteButton();
