const JOURNAL_KEY = 'verity.executionJournal.v1';
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const TERMINAL = new Set(['confirmed', 'reverted']);

export function createJournalEntry({ hash, quote, now = Date.now() }) {
  if (!HASH.test(hash || '') || Number(quote?.chainId) !== 4663 || !ADDRESS.test(quote?.from || '')) {
    throw new Error('journal_entry_invalid');
  }
  return Object.freeze({
    version: 1,
    hash,
    chainId: 4663,
    account: quote.from.toLowerCase(),
    pair: `${quote.tokenIn}/${quote.tokenOut}`,
    input: String(quote.value),
    expectedOut: String(quote.expectedOut),
    minimumOut: String(quote.minimumOut),
    slippageBps: Number(quote.slippageBps),
    gasEstimate: String(quote.gasEstimate),
    simulatedAtBlock: Number(quote.simulatedAtBlock),
    providerClass: String(quote.providerClass || 'unknown'),
    status: 'pending',
    broadcastAt: Number(now),
    settledAt: null,
    receiptBlock: null,
  });
}

export function mergeJournalEntry(entries, next, limit = 50) {
  if (!HASH.test(next?.hash || '')) return [...(entries || [])].slice(0, limit);
  const normalizedHash = next.hash.toLowerCase();
  return [next, ...(entries || []).filter((entry) => entry?.hash?.toLowerCase() !== normalizedHash)]
    .sort((a, b) => Number(b.broadcastAt || 0) - Number(a.broadcastAt || 0))
    .slice(0, limit);
}

export function updateJournalReceipt(entry, receipt, now = Date.now()) {
  const status = ['pending', 'confirmed', 'reverted', 'unknown'].includes(receipt?.status)
    ? receipt.status
    : 'unknown';
  return Object.freeze({
    ...entry,
    status,
    receiptBlock: Number.isInteger(receipt?.blockNumber) ? receipt.blockNumber : null,
    settledAt: TERMINAL.has(status) ? Number(now) : null,
  });
}

export function parseReceiptHash(search) {
  const hash = new URLSearchParams(search || '').get('hash');
  return HASH.test(hash || '') ? hash : null;
}

export function loadJournal(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(JOURNAL_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => HASH.test(entry?.hash || '') && Number(entry?.chainId) === 4663).slice(0, 50);
  } catch {
    return [];
  }
}

export function saveJournal(entries, storage = globalThis.localStorage) {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify((entries || []).slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}
