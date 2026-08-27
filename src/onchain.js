import { decodeFunctionResult, encodeFunctionData, keccak256 } from 'viem';
import { CHAIN } from './config.js';
import { validatedRpcRequest } from './rpc.js';
import { V4_POLICY, V4_QUOTER_ABI } from '../shared/v4-policy.js';

const deploymentChecks = new Map();

export function assertV4CodeHashes(hashes) {
  for (const [name, expected] of Object.entries(V4_POLICY.runtimeCodeHashes)) {
    if (hashes?.[name]?.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`v4_deployment_hash_mismatch:${name}`);
    }
  }
  return true;
}

async function verifyV4Deployments(provider, rpcRequest = validatedRpcRequest) {
  if (!deploymentChecks.has(provider)) {
    const check = (async () => {
      const targets = {
        router: V4_POLICY.router,
        poolManager: V4_POLICY.poolManager,
        quoter: V4_POLICY.quoter,
        stateView: V4_POLICY.stateView,
      };
      const hashes = Object.fromEntries(await Promise.all(Object.entries(targets).map(async ([name, address]) => {
        const code = await rpcRequest(provider, CHAIN.id, 'eth_getCode', [address, 'latest']);
        return [name, keccak256(code.value)];
      })));
      assertV4CodeHashes(hashes);
    })();
    deploymentChecks.set(provider, check);
    check.catch(() => deploymentChecks.delete(provider));
  }
  return deploymentChecks.get(provider);
}

export function rpcUrls(env = {}) {
  return [env.RPC_URL, env.RPC_FALLBACK_URL, ...CHAIN.rpcUrls].filter(Boolean);
}

function providerClass(provider, env) {
  if (provider === CHAIN.rpcUrls[0]) return 'public_rpc';
  return env.RPC_PROVIDER_CLASS === 'authenticated_rpc' ? 'authenticated_rpc' : 'custom_rpc';
}

export async function simulateMarketQuoteOnchain(params, env = {}, dependencies = {}) {
  const rpcRequest = dependencies.rpcRequest || validatedRpcRequest;
  const verifyDeployments = dependencies.verifyDeployments || ((provider) => verifyV4Deployments(provider, rpcRequest));
  const data = encodeFunctionData({
    abi: V4_QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{
      poolKey: params.poolKey,
      zeroForOne: params.zeroForOne,
      exactAmount: params.amountIn,
      hookData: params.hookData,
    }],
  });

  for (const provider of rpcUrls(env)) {
    try {
      await verifyDeployments(provider);
      const block = await rpcRequest(provider, CHAIN.id, 'eth_blockNumber');
      const call = await rpcRequest(provider, CHAIN.id, 'eth_call', [{
        from: params.wallet,
        to: V4_POLICY.quoter,
        data,
      }, block.value]);
      const [amountOut, quoteGasEstimate] = decodeFunctionResult({
        abi: V4_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        data: call.value,
      });
      return {
        amountOut,
        quoteGasEstimate,
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

export function simulateBuyOnchain(params, env = {}, dependencies = {}) {
  return simulateMarketQuoteOnchain({
    ...params,
    poolKey: V4_POLICY.poolKey,
    zeroForOne: true,
    hookData: '0x',
  }, env, dependencies);
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
