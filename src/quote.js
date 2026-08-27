import { encodeFunctionData, isAddress, parseAbi, parseEther } from 'viem';
import { CHAIN, CONTRACTS } from './config.js';

const ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)',
]);

export const EXECUTION_POLICY = Object.freeze({
  fee: 100,
  pool: '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca',
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
    fee: EXECUTION_POLICY.fee,
    tokenIn: CONTRACTS.weth,
    tokenOut: CONTRACTS.usdg,
  });
  const amountOut = typeof simulation === 'bigint' ? simulation : simulation?.amountOut;
  if (typeof amountOut !== 'bigint' || amountOut <= 0n) {
    const error = new Error('quote_unavailable');
    error.code = 'quote_unavailable';
    error.status = 502;
    throw error;
  }

  const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  const swapData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: CONTRACTS.weth,
      tokenOut: CONTRACTS.usdg,
      fee: EXECUTION_POLICY.fee,
      recipient: input.wallet,
      amountIn,
      amountOutMinimum: minimumOut,
      sqrtPriceLimitX96: 0n,
    }],
  });

  const quotedAt = now();
  const expiresAt = quotedAt + EXECUTION_POLICY.quoteTtlMs;
  const deadline = Math.floor(expiresAt / 1000);
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'multicall',
    args: [BigInt(deadline), [swapData]],
  });
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
    feeTier: EXECUTION_POLICY.fee,
    pool: EXECUTION_POLICY.pool,
    quotedAt,
    expiresAt,
    deadline,
    simulatedAtBlock: simulation?.blockNumber ?? null,
    providerClass: simulation?.providerClass ?? 'injected_test_provider',
    source: 'onchain_simulation',
  });
}
