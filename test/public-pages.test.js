import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('documentation hub publishes security, wallet, execution, receipt, and API boundaries', () => {
  const html = read('docs.html');
  for (const id of ['wallets', 'execution-lifecycle', 'security-boundary', 'receipts', 'api-reference', 'limitations']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Rabby/);
  assert.match(html, /MetaMask/);
  assert.match(html, /WalletConnect/);
  assert.match(html, /chain ID[^<]*4663/i);
  assert.match(html, /transaction hash is not success/i);
  assert.match(html, /browser-local/i);
});

test('shareable receipt page validates a hash and distinguishes pending, confirmed, reverted, and unknown', () => {
  const html = read('receipt.html');
  const script = read('receipt.js');
  assert.match(html, /id="receiptStatus"/);
  assert.match(html, /id="receiptHash"/);
  assert.match(html, /id="receiptBlock"/);
  assert.match(script, /parseReceiptHash/);
  assert.match(script, /\/api\/receipt\?hash=/);
  for (const state of ['pending', 'confirmed', 'reverted', 'unknown']) assert.match(script, new RegExp(`['"]${state}['"]`));
  assert.doesNotMatch(script, /innerHTML/);
});

test('main page exposes the local journal and public documentation routes', () => {
  const html = read('index.html');
  assert.match(html, /id="journal"/);
  assert.match(html, /id="journalList"/);
  assert.match(html, /id="exportJournalButton"/);
  assert.match(html, /href="\/docs\.html"/);
});
