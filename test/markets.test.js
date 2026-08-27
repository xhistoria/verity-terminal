import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADAPTERS,
  buildMarketCatalog,
  classifyBlockscoutBatch,
  classifyMarket,
  decodeInitializeLog,
  normalizeBlockscoutV2Log,
  parseV4FunMarkets,
  parseV4FunTotals,
} from '../src/markets.js';
import { computeV4PoolId } from '../shared/v4-policy.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const INSTANT = '0xa3a48a91b52e8553a9422f7ed71497d76405b8cc';
const ENGINE = '0x41bc055e9abc03fad3a8f65da05b93f449f3f8cc';
const TOKEN = '0x23040e07718107a58a2930a60a7685997f461937';
const POOL_KEY = Object.freeze({ currency0: ZERO, currency1: TOKEN, fee: 0x800000, tickSpacing: 200, hooks: INSTANT });
const POOL = computeV4PoolId(POOL_KEY);

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function addressTopic(address) {
  return `0x${address.slice(2).padStart(64, '0')}`;
}

test('decodeInitializeLog preserves the complete canonical PoolKey evidence', () => {
  const log = {
    address: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    blockNumber: '0x64',
    transactionHash: `0x${'22'.repeat(32)}`,
    logIndex: '0x3',
    topics: [
      '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',
      POOL,
      addressTopic(ZERO),
      addressTopic(TOKEN),
    ],
    data: `0x${word(0x800000)}${word(200)}${word(BigInt(INSTANT))}${word(2n ** 96n)}${word(0)}`,
  };
  const event = decodeInitializeLog(log);
  assert.deepEqual(event.poolKey, {
    currency0: ZERO,
    currency1: TOKEN,
    fee: 0x800000,
    tickSpacing: 200,
    hooks: INSTANT,
  });
  assert.equal(event.poolId, POOL);
  assert.equal(event.blockNumber, 100);
  assert.equal(event.logIndex, 3);
});

test('market classification never treats unknown hook capability as trust', () => {
  assert.deepEqual(classifyMarket({ hooks: ZERO }), {
    adapter: ADAPTERS.hookless,
    status: 'candidate_pending_token_and_liquidity_validation',
    reason: 'market_not_fully_validated',
  });
  assert.equal(classifyMarket({ hooks: INSTANT }).adapter, ADAPTERS.instant);
  assert.equal(classifyMarket({ hooks: ENGINE }).adapter, ADAPTERS.agenEngineV1);
  assert.deepEqual(classifyMarket({ hooks: '0x0000000000000000000000000000000000003880' }), {
    adapter: null,
    status: 'blocked',
    reason: 'hook_not_allowlisted',
  });
});

test('catalog reconciles discovery metadata to PoolManager evidence without trusting metadata as calldata', () => {
  const event = {
    poolId: POOL,
    poolKey: { currency0: ZERO, currency1: TOKEN, fee: 0x800000, tickSpacing: 200, hooks: INSTANT },
    blockNumber: 123,
    transactionHash: `0x${'33'.repeat(32)}`,
    logIndex: 1,
  };
  const catalog = buildMarketCatalog({
    observedAt: '2026-08-27T08:40:43.000Z',
    v4fun: {
      status: 'live',
      observedAt: '2026-08-27T08:40:40.000Z',
      markets: [{ sourceId: TOKEN, kind: 'classic', tokenAddress: TOKEN, name: 'Example', symbol: 'EXM' }],
    },
    blockscout: {
      state: 'PARTIAL_THROUGH_BLOCK',
      deploymentBlock: 9070,
      targetBlock: 200,
      committedThrough: 150,
      observedHead: 210,
      observedAt: '2026-08-27T08:40:42.000Z',
      events: [event],
    },
  });
  assert.equal(catalog.status, 'partial');
  assert.equal(catalog.coverage.state, 'PARTIAL_THROUGH_BLOCK');
  assert.equal(catalog.coverage.eventCompleteness, false);
  assert.equal(catalog.markets.length, 1);
  assert.equal(catalog.markets[0].poolId, POOL);
  assert.equal(catalog.markets[0].name, 'Example');
  assert.equal(catalog.markets[0].execution.adapter, ADAPTERS.instant);
  assert.equal(catalog.markets[0].execution.status, 'candidate_pending_registry_and_runtime_validation');
  assert.equal(catalog.markets[0].evidence.poolManagerInitialize, true);
});

test('v4.fun parser returns unique source-scoped market identities without executable fields', () => {
  const html = `
    <a href="/tokens/${TOKEN}">Example</a>
    <a href="/tokens/${TOKEN.toUpperCase()}">Duplicate</a>
    <a href="/markets/0x1111111111111111111111111111111111111111">Program</a>
    <a href="https://example.com/tokens/0x2222222222222222222222222222222222222222">External</a>
  `;
  assert.deepEqual(parseV4FunMarkets(html), [
    { sourceId: TOKEN, kind: 'classic', tokenAddress: TOKEN },
    { sourceId: '0x1111111111111111111111111111111111111111', kind: 'programmable', tokenAddress: null },
  ]);
});

test('v4.fun aggregate totals remain separate from identities exposed by listing routes', () => {
  const payload = String.raw`\"classicTotal\":115,\"programmableTotal\":55`;
  assert.deepEqual(parseV4FunTotals(payload), { classic: 115, programmable: 55 });
  assert.deepEqual(parseV4FunTotals('<html>schema changed</html>'), { classic: null, programmable: null });
});

test('Blockscout v2 logs normalize to the canonical decoder without changing PoolKey bytes', () => {
  const normalized = normalizeBlockscoutV2Log({
    address: { hash: MANAGER },
    block_number: 47_325_947,
    index: 1,
    transaction_hash: '0x' + 'ab'.repeat(32),
    topics: [TOPIC, POOL, addressTopic(ZERO), addressTopic(TOKEN)],
    data: `0x${word(0x800000)}${word(200)}${word(BigInt(INSTANT))}${word(1n << 96n)}${word(0)}`,
  });
  assert.equal(normalized.address, MANAGER);
  assert.equal(normalized.blockNumber, '47325947');
  assert.equal(normalized.logIndex, '1');
  assert.equal(decodeInitializeLog(normalized).poolId, POOL);
});

test('capped Blockscout batch certifies only the contiguous prefix before its boundary block', () => {
  const logs = Array.from({ length: 1000 }, (_, index) => ({ blockNumber: index === 999 ? '0x64' : '0x63' }));
  assert.deepEqual(classifyBlockscoutBatch(logs, 200), {
    state: 'PARTIAL_THROUGH_BLOCK',
    committedThrough: 99,
    pendingFrom: 100,
    targetBlock: 200,
    capped: true,
  });
  assert.deepEqual(classifyBlockscoutBatch([{ blockNumber: '0x64' }], 200), {
    state: 'BLOCKSCOUT_COMPLETE_THROUGH_TARGET',
    committedThrough: 200,
    pendingFrom: null,
    targetBlock: 200,
    capped: false,
  });
});

test('source-only and provider-unavailable records stay visible but blocked with unknown coverage', () => {
  const catalog = buildMarketCatalog({
    observedAt: '2026-08-27T08:40:43.000Z',
    v4fun: {
      status: 'live',
      markets: [{ sourceId: TOKEN, kind: 'classic', tokenAddress: TOKEN, name: 'Example', symbol: 'EXM' }],
    },
    blockscout: {
      state: 'PROVIDER_UNAVAILABLE',
      deploymentBlock: 9070,
      committedThrough: null,
      targetBlock: null,
      observedHead: null,
      events: [],
    },
  });
  assert.equal(catalog.status, 'provider_unavailable');
  assert.equal(catalog.markets.length, 1);
  assert.equal(catalog.markets[0].execution.status, 'blocked');
  assert.equal(catalog.markets[0].execution.reason, 'pool_key_unverified');
  assert.equal(catalog.markets[0].poolId, null);
  assert.equal(catalog.coverage.eventCompleteness, false);
});
