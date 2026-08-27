import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJournalEntry,
  mergeJournalEntry,
  parseReceiptHash,
  updateJournalReceipt,
} from '../public/journal.js';

const hash = `0x${'ab'.repeat(32)}`;
const quote = {
  chainId: 4663,
  from: '0x0b95bDa3F7B92eA874D060B5485eFa55a19B5448',
  tokenIn: 'ETH', tokenOut: 'USDG', value: '1000000000000000',
  expectedOut: '2495195', minimumOut: '2482719', slippageBps: 50,
  gasEstimate: '184451', simulatedAtBlock: 47123693, providerClass: 'public_rpc',
};

test('creates a bounded evidence journal entry from a broadcast transaction', () => {
  const entry = createJournalEntry({ hash, quote, now: 1_700_000_000_000 });
  assert.deepEqual(entry, {
    version: 1, hash, chainId: 4663, account: quote.from.toLowerCase(),
    pair: 'ETH/USDG', input: quote.value, expectedOut: quote.expectedOut,
    minimumOut: quote.minimumOut, slippageBps: 50, gasEstimate: quote.gasEstimate,
    simulatedAtBlock: quote.simulatedAtBlock, providerClass: 'public_rpc',
    status: 'pending', broadcastAt: 1_700_000_000_000, settledAt: null,
    receiptBlock: null,
  });
});

test('journal upserts by transaction hash, newest first, and stays bounded', () => {
  const entries = Array.from({ length: 55 }, (_, index) => ({ hash: `0x${index.toString(16).padStart(64, '0')}`, broadcastAt: index }));
  const merged = mergeJournalEntry(entries, { hash, broadcastAt: 999, status: 'pending' });
  assert.equal(merged.length, 50);
  assert.equal(merged[0].hash, hash);
  assert.equal(new Set(merged.map((entry) => entry.hash)).size, 50);
});

test('receipt updates preserve evidence and record terminal settlement truth', () => {
  const entry = createJournalEntry({ hash, quote, now: 100 });
  const confirmed = updateJournalReceipt(entry, { status: 'confirmed', blockNumber: 47_200_000 }, 200);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.receiptBlock, 47_200_000);
  assert.equal(confirmed.settledAt, 200);
  assert.equal(confirmed.expectedOut, quote.expectedOut);
  const unknown = updateJournalReceipt(entry, { status: 'unknown', blockNumber: null }, 300);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.settledAt, null);
});

test('shareable receipt accepts only a canonical transaction hash', () => {
  assert.equal(parseReceiptHash(`?hash=${hash}`), hash);
  assert.equal(parseReceiptHash('?hash=0x1234'), null);
  assert.equal(parseReceiptHash('?hash=javascript:alert(1)'), null);
});
