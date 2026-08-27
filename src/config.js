export const CHAIN = Object.freeze({
  id: 4663,
  hexId: '0x1237',
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: Object.freeze([
    'https://rpc.mainnet.chain.robinhood.com',
  ]),
  explorerUrl: 'https://robinhoodchain.blockscout.com',
});

export const CONTRACTS = Object.freeze({
  router: '0xCaf681a66D020601342297493863E78C959E5cb2',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
});

export const TOKENS = Object.freeze([
  Object.freeze({ address: CONTRACTS.weth, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 }),
  Object.freeze({ address: CONTRACTS.usdg, symbol: 'USDG', name: 'Global Dollar', decimals: 6 }),
]);

const ALLOWED_TOKENS = new Set(TOKENS.map((token) => token.address.toLowerCase()));

export function isAllowedToken(address) {
  return typeof address === 'string' && ALLOWED_TOKENS.has(address.toLowerCase());
}
