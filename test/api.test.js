import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/worker.js';

const wallet = '0x0b95bDa3F7B92eA874D060B5485eFa55a19B5448';

function request(path, init) {
  return new Request(`https://app.example${path}`, init);
}

test('health reports executable scope without claiming provider freshness', async () => {
  const app = createApp({
    chainProbe: async () => ({ blockNumber: 47_000_000, provider: 'public_rpc', checkedAt: 1000 }),
  });
  const response = await app.fetch(request('/api/health'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.chainId, 4663);
  assert.equal(body.execution.mode, 'non_custodial');
  assert.equal(body.execution.pair, 'ETH/USDG');
  assert.equal(body.provider.status, 'live');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('quote endpoint returns simulated calldata and never broadcasts', async () => {
  const app = createApp({
    simulateBuy: async () => 2_500_000n,
    estimateGas: async () => 150_000n,
    now: () => 1_000_000,
  });
  const response = await app.fetch(request('/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, amount: '0.001', slippageBps: 50 }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'quoted');
  assert.equal(body.gasEstimate, '150000');
  assert.equal(body.broadcasted, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('quote endpoint fails closed on malformed JSON', async () => {
  const app = createApp({ simulateBuy: async () => 1n });
  const response = await app.fetch(request('/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'request_invalid' });
});

test('quote endpoint enforces per-client rate and concurrency bounds', async () => {
  const body = JSON.stringify({ wallet, amount: '0.001', slippageBps: 50 });
  const app = createApp({ simulateBuy: async () => 2_500_000n, estimateGas: async () => 100_000n, now: () => 1_000 });
  for (let index = 0; index < 10; index += 1) {
    const response = await app.fetch(request('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body }));
    assert.equal(response.status, 200);
  }
  const limited = await app.fetch(request('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');

  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const concurrent = createApp({ simulateBuy: async () => { await wait; return 2_500_000n; }, estimateGas: async () => 100_000n }, {}, { maxConcurrentQuotes: 1 });
  const first = concurrent.fetch(request('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8' }, body }));
  await Promise.resolve();
  const blocked = await concurrent.fetch(request('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body }));
  assert.equal(blocked.status, 429);
  release();
  assert.equal((await first).status, 200);
});

test('receipt endpoint preserves pending and confirmed truth states', async () => {
  const hash = `0x${'ab'.repeat(32)}`;
  const confirmedApp = createApp({
    receiptReader: async () => ({ status: '0x1', blockNumber: '0x2d' }),
  });
  const confirmed = await confirmedApp.fetch(request(`/api/receipt?hash=${hash}`));
  assert.equal(confirmed.status, 200);
  assert.deepEqual(await confirmed.json(), { status: 'confirmed', blockNumber: 45, transactionHash: hash });

  const pendingApp = createApp({ receiptReader: async () => null });
  const pending = await pendingApp.fetch(request(`/api/receipt?hash=${hash}`));
  assert.deepEqual(await pending.json(), { status: 'pending', transactionHash: hash });

  const invalid = await pendingApp.fetch(request('/api/receipt?hash=not-a-hash'));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'transaction_hash_invalid' });
});

test('quote endpoint rejects oversized bodies before simulation', async () => {
  let calls = 0;
  const app = createApp({ simulateBuy: async () => { calls += 1; return 1n; } });
  const response = await app.fetch(request('/api/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, amount: '0.001', slippageBps: 50, padding: 'x'.repeat(5000) }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'request_too_large' });
  assert.equal(calls, 0);
});

test('static assets receive browser security headers', async () => {
  const assets = { fetch: async () => new Response('<h1>Verity</h1>', { headers: { 'content-type': 'text/html' } }) };
  const app = createApp({}, { ASSETS: assets });
  const response = await app.fetch(request('/'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /wss:\/\/relay\.walletconnect\.com/);
  assert.match(response.headers.get('content-security-policy'), /font-src[^;]+fonts\.reown\.com/);
  assert.match(response.headers.get('content-security-policy'), /frame-src[^;]+verify\.walletconnect\.com/);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('API rejects unsupported methods and routes', async () => {
  const app = createApp({});
  assert.equal((await app.fetch(request('/api/quote'))).status, 405);
  assert.equal((await app.fetch(request('/api/unknown'))).status, 404);
});
