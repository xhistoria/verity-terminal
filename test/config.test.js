import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN, CONTRACTS, isAllowedToken } from '../src/config.js';

test('pins Robinhood mainnet and verified execution contracts', () => {
  assert.equal(CHAIN.id, 4663);
  assert.equal(CHAIN.rpcUrls.length >= 1, true);
  assert.equal(CONTRACTS.router.toLowerCase(), '0xcaf681a66d020601342297493863e78c959e5cb2');
  assert.equal(CONTRACTS.weth.toLowerCase(), '0x0bd7d308f8e1639fab988df18a8011f41eacad73');
});

test('rejects tokens outside the explicit allowlist', () => {
  assert.equal(isAllowedToken('0x0000000000000000000000000000000000000001'), false);
  assert.equal(isAllowedToken(CONTRACTS.weth), true);
});
