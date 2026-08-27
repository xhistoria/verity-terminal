import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROBINHOOD_CHAIN,
  normalizeWalletOptions,
  walletConnectState,
} from '../public/wallet-config.js';

test('defines the exact Robinhood Chain mainnet network', () => {
  assert.equal(ROBINHOOD_CHAIN.id, 4663);
  assert.equal(ROBINHOOD_CHAIN.nativeCurrency.symbol, 'ETH');
  assert.deepEqual(ROBINHOOD_CHAIN.rpcUrls.default.http, ['https://rpc.mainnet.chain.robinhood.com']);
  assert.equal(ROBINHOOD_CHAIN.blockExplorers.default.url, 'https://robinhoodchain.blockscout.com');
});

test('WalletConnect is explicit about configured and unavailable states', () => {
  assert.deepEqual(walletConnectState(''), {
    configured: false,
    status: 'not_configured',
    message: 'WalletConnect is not configured for this deployment.',
  });
  assert.equal(walletConnectState('project-id').configured, true);
});

test('wallet chooser deduplicates connectors and prioritizes named injected wallets', () => {
  const connectors = [
    { uid: 'generic', id: 'injected', name: 'Injected' },
    { uid: 'rabby-1', id: 'io.rabby', name: 'Rabby Wallet' },
    { uid: 'metamask-1', id: 'io.metamask', name: 'MetaMask' },
    { uid: 'rabby-duplicate', id: 'io.rabby', name: 'Rabby Wallet' },
    { uid: 'wc', id: 'walletConnect', name: 'WalletConnect' },
  ];
  assert.deepEqual(normalizeWalletOptions(connectors).map(({ id, name }) => ({ id, name })), [
    { id: 'io.rabby', name: 'Rabby Wallet' },
    { id: 'io.metamask', name: 'MetaMask' },
    { id: 'walletConnect', name: 'WalletConnect' },
  ]);
});

test('wallet chooser retains generic injected fallback when no named wallet exists', () => {
  assert.deepEqual(normalizeWalletOptions([
    { uid: 'generic', id: 'injected', name: 'Browser wallet' },
  ]).map(({ id }) => id), ['injected']);
});
