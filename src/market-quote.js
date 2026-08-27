import { isAddress, parseEther, zeroAddress } from 'viem';
import { CHAIN } from './config.js';
import { computeV4PoolId } from '../shared/v4-policy.js';

const MAXIMUM_NATIVE_INPUT = 10n ** 18n;

function probeError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

export async function createMarketQuoteProbe(input, dependencies) {
  const { catalog, simulate, now = Date.now } = dependencies || {};
  if (typeof catalog !== 'function' || typeof simulate !== 'function') throw probeError('probe_dependencies_missing', 500);
  if (!isAddress(input?.wallet || '')) throw probeError('wallet_invalid');
  if (!/^0x[0-9a-f]{64}$/i.test(input?.poolId || '')) throw probeError('pool_id_invalid');

  let amountIn;
  try {
    amountIn = parseEther(String(input.amount));
  } catch {
    throw probeError('amount_out_of_range');
  }
  if (amountIn <= 0n || amountIn > MAXIMUM_NATIVE_INPUT) throw probeError('amount_out_of_range');

  const marketCatalog = await catalog();
  const market = marketCatalog?.markets?.find((entry) => entry.poolId?.toLowerCase() === input.poolId.toLowerCase());
  if (!market) throw probeError('market_not_found', 404);
  if (!market.poolKey || market.evidence?.poolManagerInitialize !== true) throw probeError('pool_key_unverified', 409);
  if (computeV4PoolId(market.poolKey).toLowerCase() !== market.poolId.toLowerCase()) throw probeError('pool_id_mismatch', 409);
  if (!market.execution?.adapter) throw probeError(market.execution?.reason || 'hook_not_allowlisted', 403);
  if (market.poolKey.currency0.toLowerCase() !== zeroAddress || market.poolKey.currency1.toLowerCase() === zeroAddress) {
    throw probeError('native_exact_input_unsupported', 403);
  }

  const simulation = await simulate({
    wallet: input.wallet,
    amountIn,
    poolKey: market.poolKey,
    zeroForOne: true,
    hookData: '0x',
  });
  if (typeof simulation?.amountOut !== 'bigint' || simulation.amountOut <= 0n) throw probeError('quote_unavailable', 502);

  const hookless = market.poolKey.hooks.toLowerCase() === zeroAddress;
  return Object.freeze({
    status: 'quote_only',
    chainId: CHAIN.id,
    poolId: market.poolId,
    poolKey: market.poolKey,
    tokenIn: zeroAddress,
    tokenOut: market.poolKey.currency1,
    amountIn: amountIn.toString(),
    expectedOut: simulation.amountOut.toString(),
    quoteGasEstimate: simulation.quoteGasEstimate?.toString() ?? null,
    simulatedAtBlock: simulation.blockNumber ?? null,
    providerClass: simulation.providerClass ?? 'injected_test_provider',
    quotedAt: now(),
    source: 'onchain_v4_quoter',
    execution: {
      status: 'blocked',
      reason: hookless
        ? 'token_and_settlement_semantics_unverified'
        : 'registry_runtime_and_settlement_semantics_unverified',
    },
  });
}
