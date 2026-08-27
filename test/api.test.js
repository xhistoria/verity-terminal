import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/worker.js';
import { V4_POLICY } from '../shared/v4-policy.js';

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
  assert.equal(body.execution.route, 'Uniswap v4 hookless exact-input single');
  assert.equal(body.execution.hooks, '0x0000000000000000000000000000000000000000');
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
  assert.equal(body.protocol, 'uniswap_v4');
  assert.equal(body.routerVersion, '2.1.1');
  assert.equal(body.gasEstimate, '150000');
  assert.equal(body.broadcasted, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('config exposes the complete pinned v4 route instead of a generic router', async () => {
  const app = createApp();
  const response = await app.fetch(request('/api/config'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.execution.protocol, 'uniswap_v4');
  assert.equal(body.execution.feeTier, 500);
  assert.equal(body.execution.tickSpacing, 10);
  assert.equal(body.execution.pool, '0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982');
  assert.equal(body.execution.hooks, '0x0000000000000000000000000000000000000000');
  assert.equal(body.execution.command, '0x10');
  assert.equal(body.execution.actions, '0x060c0f');
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

test('market quote endpoint returns liquidity evidence but never transaction fields', async () => {
  const app = createApp({
    marketCatalog: async () => ({
      status: 'partial',
      markets: [{
        poolId: V4_POLICY.poolId,
        poolKey: V4_POLICY.poolKey,
        evidence: { poolManagerInitialize: true },
        execution: { adapter: 'hookless-v1', status: 'candidate_pending_token_and_liquidity_validation' },
      }],
    }),
    simulateMarket: async () => ({ amountOut: 2_500_000n, quoteGasEstimate: 42_000n, blockNumber: 47_000_000, providerClass: 'public_rpc' }),
    now: () => 1_800_000_000_000,
  });
  const response = await app.fetch(request('/api/market-quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, poolId: V4_POLICY.poolId, amount: '0.001' }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'quote_only');
  assert.equal(body.execution.status, 'blocked');
  assert.equal(body.broadcasted, false);
  assert.equal('data' in body, false);
  assert.equal('to' in body, false);
});

test('markets endpoint exposes source coverage separately from execution eligibility', async () => {
  const app = createApp({
    marketCatalog: async () => ({
      status: 'partial',
      observedAt: '2026-08-27T08:40:43.000Z',
      coverage: {
        state: 'PARTIAL_THROUGH_BLOCK',
        committedThrough: 150,
        targetBlock: 200,
        eventCompleteness: false,
      },
      sources: { v4fun: { status: 'live' }, blockscout: { status: 'partial' } },
      markets: [{ poolId: null, execution: { status: 'blocked', reason: 'pool_key_unverified' } }],
    }),
  });
  const response = await app.fetch(request('/api/markets'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.status, 'partial');
  assert.equal(body.coverage.eventCompleteness, false);
  assert.equal(body.markets[0].execution.status, 'blocked');
});

test('markets endpoint preserves provider-unavailable instead of returning an empty success', async () => {
  const app = createApp({ marketCatalog: async () => { throw new Error('provider_unavailable'); } });
  const response = await app.fetch(request('/api/markets'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'provider_unavailable',
    coverage: { state: 'PROVIDER_UNAVAILABLE', eventCompleteness: false },
  });
});

test('API rejects unsupported methods and routes', async () => {
  const app = createApp({});
  assert.equal((await app.fetch(request('/api/quote'))).status, 405);
  assert.equal((await app.fetch(request('/api/markets', { method: 'POST' }))).status, 405);
  assert.equal((await app.fetch(request('/api/unknown'))).status, 404);
});
