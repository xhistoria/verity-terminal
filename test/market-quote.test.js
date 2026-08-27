import test from 'node:test';
import assert from 'node:assert/strict';
import { computeV4PoolId } from '../shared/v4-policy.js';
import { createMarketQuoteProbe } from '../src/market-quote.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const TOKEN = '0x81990adb80b272c9c5b62cc2fc017ca9efe47777';
const WALLET = '0x1111111111111111111111111111111111111111';
const POOL_KEY = Object.freeze({ currency0: ZERO, currency1: TOKEN, fee: 500, tickSpacing: 10, hooks: ZERO });
const POOL_ID = computeV4PoolId(POOL_KEY);

function catalog(overrides = {}) {
  return {
    status: 'partial',
    markets: [{
      poolId: POOL_ID,
      poolKey: POOL_KEY,
      evidence: { poolManagerInitialize: true },
      execution: { adapter: 'hookless-v1', status: 'candidate_pending_token_and_liquidity_validation', reason: 'market_not_fully_validated' },
      ...overrides,
    }],
  };
}

test('market quote probe returns read-only liquidity evidence without sendable calldata', async () => {
  let simulationInput;
  const result = await createMarketQuoteProbe({ wallet: WALLET, poolId: POOL_ID, amount: '0.001' }, {
    catalog: async () => catalog(),
    simulate: async (input) => {
      simulationInput = input;
      return { amountOut: 123456n, quoteGasEstimate: 9876n, blockNumber: 47_325_000, providerClass: 'public_rpc' };
    },
    now: () => 1_800_000_000_000,
  });
  assert.deepEqual(simulationInput.poolKey, POOL_KEY);
  assert.equal(simulationInput.zeroForOne, true);
  assert.equal(simulationInput.hookData, '0x');
  assert.equal(result.status, 'quote_only');
  assert.equal(result.execution.status, 'blocked');
  assert.equal(result.execution.reason, 'token_and_settlement_semantics_unverified');
  assert.equal(result.expectedOut, '123456');
  assert.equal(result.poolId, POOL_ID);
  assert.equal('data' in result, false);
  assert.equal('to' in result, false);
  assert.equal('minimumOut' in result, false);
});

test('market quote probe rejects source-only markets and unknown hooks before RPC', async () => {
  let calls = 0;
  const simulate = async () => { calls += 1; return { amountOut: 1n }; };
  await assert.rejects(
    createMarketQuoteProbe({ wallet: WALLET, poolId: POOL_ID, amount: '0.001' }, {
      catalog: async () => catalog({ poolKey: null, evidence: { poolManagerInitialize: false } }),
      simulate,
    }),
    /pool_key_unverified/,
  );
  await assert.rejects(
    createMarketQuoteProbe({ wallet: WALLET, poolId: POOL_ID, amount: '0.001' }, {
      catalog: async () => catalog({ execution: { adapter: null, status: 'blocked', reason: 'hook_not_allowlisted' } }),
      simulate,
    }),
    /hook_not_allowlisted/,
  );
  assert.equal(calls, 0);
});

test('market quote probe binds PoolId to PoolKey and bounds native input', async () => {
  const dependencies = { catalog: async () => catalog(), simulate: async () => ({ amountOut: 1n }) };
  await assert.rejects(createMarketQuoteProbe({ wallet: WALLET, poolId: POOL_ID, amount: '1.000000000000000001' }, dependencies), /amount_out_of_range/);
  await assert.rejects(createMarketQuoteProbe({ wallet: WALLET, poolId: '0x' + 'ff'.repeat(32), amount: '0.001' }, dependencies), /market_not_found/);
  await assert.rejects(createMarketQuoteProbe({ wallet: WALLET, poolId: POOL_ID, amount: '0.001' }, {
    catalog: async () => catalog({ poolKey: { ...POOL_KEY, currency1: '0x2222222222222222222222222222222222222222' } }),
    simulate: dependencies.simulate,
  }), /pool_id_mismatch/);
});
