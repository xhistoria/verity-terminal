import { decodeV4ExactIn, V4_POLICY } from '../shared/v4-policy.js';

function decodeAndValidateCalldata(quote, account) {
  try {
    const decoded = decodeV4ExactIn(quote.data);
    if (decoded.deadline !== BigInt(quote.deadline)
      || decoded.deadline !== BigInt(Math.floor(Number(quote.expiresAt) / 1000))) return false;
    return decoded.amountIn === BigInt(quote.amountIn)
      && decoded.amountIn === BigInt(quote.value)
      && decoded.minimumOut === BigInt(quote.minimumOut)
      && quote.from.toLowerCase() === account.toLowerCase();
  } catch {
    return false;
  }
}

export function isQuoteExecutable(quote, context) {
  if (!quote || !context.account) return false;
  try {
    const slippageBps = Number(quote.slippageBps);
    const amountIn = BigInt(quote.amountIn);
    const expectedOut = BigInt(quote.expectedOut);
    const minimumOut = BigInt(quote.minimumOut);
    const quotedAt = Number(quote.quotedAt);
    const expiresAt = Number(quote.expiresAt);
    const now = Number(context.now);
    const boundedOutput = Number.isInteger(slippageBps)
      && slippageBps >= 10
      && slippageBps <= 500
      && expectedOut > 0n
      && minimumOut > 0n
      && minimumOut === expectedOut * BigInt(10_000 - slippageBps) / 10_000n;
    const boundedLifetime = Number.isFinite(quotedAt)
      && Number.isFinite(expiresAt)
      && Number.isFinite(now)
      && expiresAt - quotedAt === 60_000
      && quotedAt <= now + 5_000
      && expiresAt <= now + 65_000;
    return Boolean(
      Number(quote.chainId) === Number(context.chainId)
      && quote.from?.toLowerCase() === context.account.toLowerCase()
      && quote.to?.toLowerCase() === V4_POLICY.router.toLowerCase()
      && quote.tokenIn === 'ETH'
      && quote.tokenOut === 'USDG'
      && quote.protocol === V4_POLICY.protocol
      && quote.routerVersion === V4_POLICY.routerVersion
      && quote.pool?.toLowerCase() === V4_POLICY.poolId.toLowerCase()
      && quote.hooks?.toLowerCase() === V4_POLICY.poolKey.hooks.toLowerCase()
      && Number(quote.feeTier) === V4_POLICY.poolKey.fee
      && amountIn > 0n
      && amountIn <= 10n ** 18n
      && boundedOutput
      && boundedLifetime
      && BigInt(quote.value) === amountIn
      && now < expiresAt
      && typeof quote.data === 'string'
      && /^0x[0-9a-f]+$/i.test(quote.data)
      && decodeAndValidateCalldata(quote, context.account)
    );
  } catch {
    return false;
  }
}

export function walletConnectionGuidance(error) {
  const code = error?.code ?? error?.cause?.code;
  const name = error?.name || error?.cause?.name;
  const message = error?.message || error?.cause?.message;
  if (code === 4001 || name === 'UserRejectedRequestError') return 'Wallet connection rejected.';
  if (message === 'wallet_connector_unavailable') {
    return 'That wallet connector is no longer available. Reopen the chooser and select an active wallet.';
  }
  if (message === 'wallet_not_found') {
    return 'No compatible wallet was detected. Open Verity inside your wallet browser or use a desktop browser with an injected wallet extension. WalletConnect availability depends on deployment configuration.';
  }
  return 'Unable to connect a compatible EIP-1193 wallet. Check that the wallet is unlocked, then try again.';
}

export function shouldCompactNav(compact, scrollPosition) {
  const y = Math.max(0, Number(scrollPosition) || 0);
  return compact ? y > 16 : y >= 80;
}

export function createExecutionLock() {
  let active = false;
  return Object.freeze({
    inFlight: () => active,
    async run(operation) {
      if (active) return null;
      active = true;
      try { return await operation(); }
      finally { active = false; }
    },
  });
}

export function createWalletContextGuard() {
  let revision = 0;
  return Object.freeze({
    snapshot: () => revision,
    invalidate: () => { revision += 1; return revision; },
    isCurrent: (snapshot) => Number.isInteger(snapshot) && snapshot === revision,
  });
}

export function toRpcTransaction(quote, chainId) {
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('wallet_chain_invalid');
  return {
    from: quote.from,
    to: quote.to,
    value: `0x${BigInt(quote.value).toString(16)}`,
    data: quote.data,
    chainId: `0x${chainId.toString(16)}`,
  };
}

export function formatUnits(raw, decimals, precision = 4) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Not connected';
}
