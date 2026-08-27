import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN, CONTRACTS, isAllowedToken } from '../src/config.js';
import { computeV4PoolId, V4_POLICY } from '../shared/v4-policy.js';

test('pins Robinhood mainnet and verified execution contracts', () => {
  assert.equal(CHAIN.id, 4663);
  assert.equal(CHAIN.rpcUrls.length >= 1, true);
  assert.equal(CONTRACTS.router.toLowerCase(), '0x06afba43fd06227fa663b0daecf536f6eaa6bf99');
  assert.equal(CONTRACTS.poolManager.toLowerCase(), '0x8366a39cc670b4001a1121b8f6a443a643e40951');
  assert.equal(CONTRACTS.v4Quoter.toLowerCase(), '0x8dc178efb8111bb0973dd9d722ebeff267c98f94');
  assert.equal(CONTRACTS.weth.toLowerCase(), '0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  assert.equal(computeV4PoolId(V4_POLICY.poolKey), V4_POLICY.poolId);
});

test('rejects tokens outside the explicit allowlist', () => {
  assert.equal(isAllowedToken('0x0000000000000000000000000000000000000001'), false);
  assert.equal(isAllowedToken(CONTRACTS.weth), true);
});
