import { CHAIN, CONTRACTS, TOKENS } from './config.js';
import { createBuyQuote, EXECUTION_POLICY } from './quote.js';
import { estimateTransactionGas, probeChain, readTransactionReceipt, simulateBuyOnchain } from './onchain.js';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('request_invalid');
  const text = await request.text();
  if (text.length > 4096) throw new Error('request_too_large');
  try { return JSON.parse(text); } catch { throw new Error('request_invalid'); }
}

export function createApp(overrides = {}, env = {}, options = {}) {
  const rateLimit = options.rateLimit ?? 10;
  const rateWindowMs = options.rateWindowMs ?? 60_000;
  const maxConcurrentQuotes = options.maxConcurrentQuotes ?? 4;
  const clientWindows = new Map();
  let activeQuotes = 0;
  const dependencies = {
    simulateBuy: overrides.simulateBuy || ((params) => simulateBuyOnchain(params, env)),
    estimateGas: overrides.estimateGas || ((quote, context) => estimateTransactionGas(quote, env, context)),
    chainProbe: overrides.chainProbe || (() => probeChain(env)),
    receiptReader: overrides.receiptReader || ((hash) => readTransactionReceipt(hash, env)),
    now: overrides.now || Date.now,
  };

  function acquireQuoteCapacity(request) {
    const now = dependencies.now();
    const forwarded = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const current = clientWindows.get(forwarded);
    const windowState = !current || now - current.startedAt >= rateWindowMs
      ? { startedAt: now, count: 0 }
      : current;
    if (windowState.count >= rateLimit || activeQuotes >= maxConcurrentQuotes) return false;
    windowState.count += 1;
    clientWindows.set(forwarded, windowState);
    activeQuotes += 1;
    return true;
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === '/api/health') {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        try {
          const state = await dependencies.chainProbe();
          return json({
            status: 'ok',
            chainId: CHAIN.id,
            chainName: CHAIN.name,
            blockNumber: state.blockNumber,
            provider: { status: 'live', source: state.provider, checkedAt: state.checkedAt },
            execution: {
              mode: 'non_custodial',
              pair: 'ETH/USDG',
              route: 'Uniswap V3 exactInputSingle',
              router: CONTRACTS.router,
              pool: EXECUTION_POLICY.pool,
              serverSigning: false,
              broadcastByServer: false,
            },
          });
        } catch {
          return json({
            status: 'degraded',
            chainId: CHAIN.id,
            provider: { status: 'provider_unavailable' },
            execution: { mode: 'disabled_until_provider_recovers' },
          }, 503);
        }
      }

      if (url.pathname === '/api/config') {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        return json({
          chain: CHAIN,
          tokens: TOKENS,
          execution: {
            pair: 'ETH/USDG',
            router: CONTRACTS.router,
            pool: EXECUTION_POLICY.pool,
            feeTier: EXECUTION_POLICY.fee,
            slippageBps: { min: 10, default: 50, max: 500 },
            maxAmountWei: EXECUTION_POLICY.maximumAmountWei.toString(),
          },
        });
      }

      if (url.pathname === '/api/receipt') {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const hash = url.searchParams.get('hash') || '';
        if (!/^0x[0-9a-f]{64}$/i.test(hash)) return json({ error: 'transaction_hash_invalid' }, 400);
        try {
          const receipt = await dependencies.receiptReader(hash);
          if (!receipt) return json({ status: 'pending', transactionHash: hash });
          const status = receipt.status === '0x1' ? 'confirmed' : receipt.status === '0x0' ? 'reverted' : 'unknown';
          return json({
            status,
            blockNumber: receipt.blockNumber ? Number(BigInt(receipt.blockNumber)) : null,
            transactionHash: hash,
          });
        } catch {
          return json({ error: 'provider_unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/quote') {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        if (!acquireQuoteCapacity(request)) {
          return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' });
        }
        try {
          const input = await readJson(request);
          let simulationContext = null;
          const quote = await createBuyQuote(input, {
            simulate: async (params) => {
              const result = await dependencies.simulateBuy(params);
              if (result && typeof result === 'object') simulationContext = result;
              return result;
            },
            now: dependencies.now,
          });
          const gasEstimate = await dependencies.estimateGas(quote, simulationContext);
          return json({ ...quote, gasEstimate: gasEstimate.toString(), broadcasted: false });
        } catch (error) {
          const code = error?.code || error?.message;
          const safe = new Set([
            'request_invalid', 'request_too_large', 'wallet_invalid', 'amount_out_of_range',
            'slippage_out_of_range', 'quote_unavailable', 'provider_unavailable',
          ]);
          const message = safe.has(code) ? code : 'quote_unavailable';
          const status = message === 'provider_unavailable' || message === 'quote_unavailable' ? 502 : 400;
          return json({ error: message }, status);
        } finally {
          activeQuotes -= 1;
        }
      }

      if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      response.headers.set('x-frame-options', 'DENY');
      response.headers.set('x-content-type-options', 'nosniff');
      response.headers.set('referrer-policy', 'no-referrer');
      response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
      response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
      response.headers.set('cross-origin-opener-policy', 'same-origin');
      response.headers.set('cross-origin-resource-policy', 'same-origin');
      return response;
    },
  };
}

let workerApp;

export default {
  fetch(request, env) {
    workerApp ||= createApp({}, env);
    return workerApp.fetch(request);
  },
};
