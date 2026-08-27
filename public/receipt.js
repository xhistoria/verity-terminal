import { parseReceiptHash } from './journal.js';

const els = Object.fromEntries(['receiptStatus', 'receiptMessage', 'receiptHash', 'receiptBlock', 'receiptExplorer', 'refreshReceipt']
  .map((id) => [id, document.getElementById(id)]));
const hash = parseReceiptHash(window.location.search);
let activeRequest = false;

function render(status, message, blockNumber = null) {
  els.receiptStatus.textContent = status.toUpperCase();
  els.receiptStatus.className = `state-badge ${status === 'confirmed' ? 'confirmed' : status === 'pending' ? 'pending' : 'failed'}`;
  els.receiptMessage.textContent = message;
  els.receiptBlock.textContent = Number.isInteger(blockNumber) ? blockNumber.toLocaleString() : 'Not available';
}

async function checkReceipt() {
  if (!hash || activeRequest) return;
  activeRequest = true;
  els.refreshReceipt.disabled = true;
  render('pending', 'Checking the chain-pinned receipt endpoint.');
  try {
    const response = await fetch(`/api/receipt?hash=${encodeURIComponent(hash)}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'receipt_unavailable');
    if (body.status === 'confirmed') render('confirmed', 'Receipt status is successful on Robinhood Chain. This is not an L1-finality claim.', body.blockNumber);
    else if (body.status === 'reverted') render('reverted', 'The transaction receipt reports a revert.', body.blockNumber);
    else if (body.status === 'pending') render('pending', 'No receipt is available yet. A transaction hash is not treated as success.');
    else render('unknown', 'Receipt status is unknown and is not treated as success.', body.blockNumber);
  } catch {
    render('unknown', 'Receipt provider is unavailable. No success state can be established.');
  } finally {
    activeRequest = false;
    els.refreshReceipt.disabled = false;
  }
}

if (!hash) {
  els.receiptHash.textContent = 'Invalid or missing transaction hash';
  els.receiptExplorer.removeAttribute('href');
  els.receiptExplorer.setAttribute('aria-disabled', 'true');
  els.refreshReceipt.disabled = true;
  render('unknown', 'Provide a canonical 32-byte transaction hash in the URL.');
} else {
  els.receiptHash.textContent = hash;
  els.receiptExplorer.href = `https://robinhoodchain.blockscout.com/tx/${hash}`;
  els.refreshReceipt.addEventListener('click', checkReceipt);
  checkReceipt();
}
