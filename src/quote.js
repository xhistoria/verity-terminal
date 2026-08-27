import { isAddress, parseEther } from 'viem';
import { CHAIN, CONTRACTS } from './config.js';
import { encodeV4ExactIn, V4_POLICY } from '../shared/v4-policy.js';

export const EXECUTION_POLICY = Object.freeze({
  fee: V4_POLICY.poolKey.fee,
  pool: V4_POLICY.poolId,
  minimumSlippageBps: 10,
  maximumSlippageBps: 500,
  maximumAmountWei: 10n ** 18n,
  quoteTtlMs: 60_000,
});

function policyError(code) {
  const error = new Error(code);
  error.code = code;
  error.status = 400;
  return error;
}

export async function createBuyQuote(input, dependencies) {
  const { simulate, now = Date.now } = dependencies;
  if (!isAddress(input?.wallet || '')) throw policyError('wallet_invalid');

  let amountIn;
  try {
    amountIn = parseEther(String(input.amount));
  } catch {
    throw policyError('amount_out_of_range');
  }
  if (amountIn <= 0n || amountIn > EXECUTION_POLICY.maximumAmountWei) {
    throw policyError('amount_out_of_range');
  }

  const slippageBps = Number(input.slippageBps);
  if (!Number.isInteger(slippageBps)
    || slippageBps < EXECUTION_POLICY.minimumSlippageBps
    || slippageBps > EXECUTION_POLICY.maximumSlippageBps) {
    throw policyError('slippage_out_of_range');
  }

  const simulation = await simulate({
    wallet: input.wallet,
    amountIn,
    poolKey: V4_POLICY.poolKey,
    zeroForOne: true,
    hookData: '0x',
  });
  const amountOut = typeof simulation === 'bigint' ? simulation : simulation?.amountOut;
  if (typeof amountOut !== 'bigint' || amountOut <= 0n) {
    const error = new Error('quote_unavailable');
    error.code = 'quote_unavailable';
    error.status = 502;
    throw error;
  }

  const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  if (minimumOut <= 0n) {
    const error = new Error('quote_unavailable');
    error.code = 'quote_unavailable';
    error.status = 502;
    throw error;
  }
  const quotedAt = now();
  const expiresAt = quotedAt + EXECUTION_POLICY.quoteTtlMs;
  const deadline = Math.floor(expiresAt / 1000);
  const data = encodeV4ExactIn({ amountIn, minimumOut, deadline });
  return Object.freeze({
    status: 'quoted',
    chainId: CHAIN.id,
    to: CONTRACTS.router,
    from: input.wallet,
    value: amountIn.toString(),
    data,
    tokenIn: 'ETH',
    tokenOut: 'USDG',
    amountIn: amountIn.toString(),
    expectedOut: amountOut.toString(),
    minimumOut: minimumOut.toString(),
    slippageBps,
    protocol: V4_POLICY.protocol,
    routerVersion: V4_POLICY.routerVersion,
    feeTier: EXECUTION_POLICY.fee,
    pool: EXECUTION_POLICY.pool,
    hooks: V4_POLICY.poolKey.hooks,
    quotedAt,
    expiresAt,
    deadline,
    simulatedAtBlock: simulation?.blockNumber ?? null,
    providerClass: simulation?.providerClass ?? 'injected_test_provider',
    source: 'onchain_simulation',
  });
}
