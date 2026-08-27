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
  router: '0x06afBA43fd06227fA663b0dAeCF536F6eaA6BF99',
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  v4Quoter: '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94',
  stateView: '0xF3334192D15450CDD385c8B70e03f9a6bD9E673b',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
});

export const TOKENS = Object.freeze([
  Object.freeze({ address: CONTRACTS.weth, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 }),
  Object.freeze({ address: CONTRACTS.usdg, symbol: 'USDG', name: 'Global Dollar', decimals: 6 }),
]);

const ALLOWED_TOKENS = new Set(TOKENS.map((token) => token.address.toLowerCase()));

export function isAllowedToken(address) {
  return typeof address === 'string' && ALLOWED_TOKENS.has(address.toLowerCase());
}
