import { defineChain } from 'viem';

export const ROBINHOOD_CHAIN = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export function walletConnectState(projectId) {
  const configured = typeof projectId === 'string' && projectId.trim().length > 0;
  return configured
    ? { configured: true, status: 'configured', message: 'WalletConnect is available.' }
    : { configured: false, status: 'not_configured', message: 'WalletConnect is not configured for this deployment.' };
}

export function normalizeWalletOptions(connectors) {
  const unique = [];
  const seen = new Set();
  for (const connector of connectors || []) {
    const id = String(connector?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(connector);
  }
  const named = unique.filter((connector) => connector.id !== 'injected');
  const available = named.some((connector) => connector.id !== 'walletConnect')
    ? unique.filter((connector) => connector.id !== 'injected')
    : unique;
  return available.sort((a, b) => {
    const priority = (connector) => connector.id === 'walletConnect' ? 2 : connector.id === 'injected' ? 1 : 0;
    return priority(a) - priority(b);
  });
}
