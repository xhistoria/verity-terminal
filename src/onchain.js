import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { CHAIN, CONTRACTS } from './config.js';
import { validatedRpcRequest } from './rpc.js';

const ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
]);

export function rpcUrls(env = {}) {
  return [env.RPC_URL, env.RPC_FALLBACK_URL, ...CHAIN.rpcUrls].filter(Boolean);
}

function providerClass(provider, env) {
  if (provider === CHAIN.rpcUrls[0]) return 'public_rpc';
  return env.RPC_PROVIDER_CLASS === 'authenticated_rpc' ? 'authenticated_rpc' : 'custom_rpc';
}

export async function simulateBuyOnchain(params, env = {}) {
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.fee,
      recipient: params.wallet,
      amountIn: params.amountIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    }],
  });

  for (const provider of rpcUrls(env)) {
    try {
      const block = await validatedRpcRequest(provider, CHAIN.id, 'eth_blockNumber');
      const call = await validatedRpcRequest(provider, CHAIN.id, 'eth_call', [{
        from: params.wallet,
        to: CONTRACTS.router,
        value: `0x${params.amountIn.toString(16)}`,
        data,
      }, block.value]);
      return {
        amountOut: decodeFunctionResult({ abi: ROUTER_ABI, functionName: 'exactInputSingle', data: call.value }),
        blockNumber: Number(BigInt(block.value)),
        blockTag: block.value,
        provider,
        providerClass: providerClass(provider, env),
      };
    } catch {
      // Fail over only before a quote is returned. Gas estimation stays on the selected provider/block.
    }
  }
  const error = new Error('provider_unavailable');
  error.code = 'provider_unavailable';
  throw error;
}

export async function estimateTransactionGas(quote, env = {}, context = {}) {
  if (!context.provider || !context.blockTag) {
    const error = new Error('simulation_context_missing');
    error.code = 'simulation_context_missing';
    throw error;
  }
  const { value } = await validatedRpcRequest(context.provider, CHAIN.id, 'eth_estimateGas', [{
    from: quote.from,
    to: quote.to,
    value: `0x${BigInt(quote.value).toString(16)}`,
    data: quote.data,
  }, context.blockTag]);
  return BigInt(value);
}

export async function readTransactionReceipt(hash, env = {}) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) {
    const error = new Error('transaction_hash_invalid');
    error.code = 'transaction_hash_invalid';
    throw error;
  }
  for (const provider of rpcUrls(env)) {
    try {
      const receipt = await validatedRpcRequest(provider, CHAIN.id, 'eth_getTransactionReceipt', [hash]);
      return receipt.value;
    } catch { /* try next validated Robinhood Chain provider */ }
  }
  const error = new Error('provider_unavailable');
  error.code = 'provider_unavailable';
  throw error;
}

export async function probeChain(env = {}) {
  for (const provider of rpcUrls(env)) {
    try {
      const block = await validatedRpcRequest(provider, CHAIN.id, 'eth_blockNumber');
      return {
        blockNumber: Number(BigInt(block.value)),
        provider: providerClass(provider, env),
        checkedAt: Date.now(),
      };
    } catch { /* try next provider */ }
  }
  const error = new Error('provider_unavailable');
  error.code = 'provider_unavailable';
  throw error;
}
