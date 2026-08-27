import {
  connect,
  createConfig,
  createStorage,
  disconnect,
  getConnectors,
  reconnect,
  watchConnectors,
  http,
} from '@wagmi/core';
import { injected } from '@wagmi/connectors/injected';
import { walletConnect } from '@wagmi/connectors/walletConnect';
import { normalizeWalletOptions, ROBINHOOD_CHAIN, walletConnectState } from './wallet-config.js';

const projectId = __REOWN_PROJECT_ID__;
const wcState = walletConnectState(projectId);
const connectorFactories = [injected({ shimDisconnect: true })];

if (wcState.configured) {
  connectorFactories.push(walletConnect({
    projectId,
    showQrModal: true,
    isNewChainsStale: true,
    metadata: {
      name: 'Verity Terminal',
      description: 'Constrained non-custodial execution on Robinhood Chain',
      url: window.location.origin,
      icons: [`${window.location.origin}/verity-icon.svg`],
    },
  }));
}

const config = createConfig({
  chains: [ROBINHOOD_CHAIN],
  connectors: connectorFactories,
  multiInjectedProviderDiscovery: true,
  storage: createStorage({ storage: window.localStorage, key: 'verity.wallet' }),
  transports: { [ROBINHOOD_CHAIN.id]: http(ROBINHOOD_CHAIN.rpcUrls.default.http[0]) },
});

function publicConnector(connector) {
  return Object.freeze({ uid: connector.uid, id: connector.id, name: connector.name });
}

export function getWalletConnectState() {
  return wcState;
}

export async function listWalletConnectors() {
  await new Promise((resolve) => setTimeout(resolve, 75));
  const available = [];
  for (const connector of getConnectors(config)) {
    if (connector.id === 'walletConnect') {
      available.push(connector);
      continue;
    }
    try {
      if (await connector.getProvider()) available.push(connector);
    } catch { /* unavailable connectors are omitted */ }
  }
  return normalizeWalletOptions(available).map(publicConnector);
}

export function watchWalletConnectors(onChange) {
  return watchConnectors(config, {
    onChange: async () => onChange(await listWalletConnectors()),
  });
}

export async function connectWalletConnector(uid) {
  const connector = getConnectors(config).find((candidate) => candidate.uid === uid);
  if (!connector) throw new Error('wallet_connector_unavailable');
  const result = await connect(config, { connector, chainId: ROBINHOOD_CHAIN.id });
  const provider = await connector.getProvider();
  if (!provider || !result.accounts?.[0]) throw new Error('wallet_account_unavailable');
  return { provider, account: result.accounts[0], chainId: result.chainId, connector: publicConnector(connector) };
}

export async function reconnectWalletConnector() {
  const connections = await reconnect(config);
  const connection = connections[0];
  if (!connection?.accounts?.[0]) return null;
  const provider = await connection.connector.getProvider();
  if (!provider) return null;
  return {
    provider,
    account: connection.accounts[0],
    chainId: connection.chainId,
    connector: publicConnector(connection.connector),
  };
}

export async function disconnectWalletConnector() {
  await disconnect(config);
}
