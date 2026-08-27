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
  assert.match(html, /Uniswap v4/i);
  assert.match(html, /0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982/i);
  assert.match(html, /hookless/i);
  assert.match(html, /V4_SWAP/);
  assert.match(html, /Runtime code hashes/);
  assert.match(html, /0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5/i);
  assert.doesNotMatch(html, /V3 pool|SwapRouter02/);
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

test('main page exposes multi-market discovery, explicit coverage, and the local receipt journal', () => {
  const html = read('index.html');
  const script = read('app.js');
  for (const id of ['marketExplorer', 'marketSearch', 'marketFilters', 'marketGrid', 'marketCoverage', 'marketSummary', 'marketLoadMore']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /All markets/i);
  assert.match(html, /Adapter candidates/i);
  assert.match(script, /PoolKey details/i);
  assert.match(script, /Quote only/i);
  assert.match(html, /Unverified hooks/i);
  assert.match(html, /coverage/i);
  assert.match(html, /id="journal"/);
  assert.match(html, /id="journalList"/);
  assert.match(html, /id="exportJournalButton"/);
  assert.match(html, /id="reviewProtocol"/);
  assert.match(html, /id="reviewPool"/);
  assert.match(html, /href="\/docs\.html"/);
  assert.match(script, /fetch\('\/api\/markets'/);
  assert.match(script, /fetch\('\/api\/market-quote'/);
  assert.match(script, /MARKET_PAGE_SIZE/);
  assert.match(script, /provider_unavailable/);
  assert.match(script, /pool_key_unverified/);
  assert.match(script, /verity\.execution-journal\.v2/);
  assert.match(script, /method: 'eth_accounts'/);
  assert.doesNotMatch(script, /marketGrid\.innerHTML/);
});
