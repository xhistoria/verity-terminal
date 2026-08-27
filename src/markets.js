import { computeV4PoolId } from '../shared/v4-policy.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const INITIALIZE_TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';

export const ADAPTERS = Object.freeze({
  hookless: 'hookless-v1',
  instant: 'classic-instant-v1',
  legacyVerdant: 'programmable-verdant-shared-hook',
  agenEngineV1: 'programmable-agen-engine-v1',
});

const HOOK_ADAPTERS = new Map([
  [ZERO_ADDRESS, ADAPTERS.hookless],
  ['0xa3a48a91b52e8553a9422f7ed71497d76405b8cc', ADAPTERS.instant],
  ['0xf998c32cddfa6354bd80aab470c6ecf4d83bb880', ADAPTERS.legacyVerdant],
  ['0x41bc055e9abc03fad3a8f65da05b93f449f3f8cc', ADAPTERS.agenEngineV1],
]);

function normalizeAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) return null;
  return value.toLowerCase();
}

function addressFromWord(value) {
  return normalizeAddress(`0x${value.slice(-40)}`);
}

function asInt24(value) {
  return Number(BigInt.asIntN(24, BigInt(`0x${value}`)));
}

export function classifyMarket(poolKey) {
  const hook = normalizeAddress(poolKey?.hooks);
  const adapter = hook ? HOOK_ADAPTERS.get(hook) : null;
  if (!adapter) return { adapter: null, status: 'blocked', reason: 'hook_not_allowlisted' };
  return {
    adapter,
    status: hook === ZERO_ADDRESS
      ? 'candidate_pending_token_and_liquidity_validation'
      : 'candidate_pending_registry_and_runtime_validation',
    reason: 'market_not_fully_validated',
  };
}

export function decodeInitializeLog(log) {
  if (normalizeAddress(log?.address) !== POOL_MANAGER) throw new Error('initialize_manager_invalid');
  if (!Array.isArray(log.topics) || log.topics.length < 4 || log.topics[0]?.toLowerCase() !== INITIALIZE_TOPIC) {
    throw new Error('initialize_topic_invalid');
  }
  if (typeof log.data !== 'string' || !/^0x[0-9a-f]{320}$/i.test(log.data)) throw new Error('initialize_data_invalid');
  const words = log.data.slice(2).match(/.{64}/g);
  const poolKey = {
    currency0: addressFromWord(log.topics[2]),
    currency1: addressFromWord(log.topics[3]),
    fee: Number(BigInt(`0x${words[0]}`)),
    tickSpacing: asInt24(words[1]),
    hooks: addressFromWord(words[2]),
  };
  if (!poolKey.currency0 || !poolKey.currency1 || !poolKey.hooks) throw new Error('initialize_address_invalid');
  const poolId = log.topics[1]?.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(poolId || '')) throw new Error('initialize_pool_id_invalid');
  if (computeV4PoolId(poolKey).toLowerCase() !== poolId) throw new Error('initialize_pool_id_mismatch');
  return Object.freeze({
    poolId,
    poolKey: Object.freeze(poolKey),
    sqrtPriceX96: BigInt(`0x${words[3]}`).toString(),
    tick: asInt24(words[4]),
    blockNumber: Number(BigInt(log.blockNumber)),
    transactionHash: log.transactionHash?.toLowerCase(),
    logIndex: Number(BigInt(log.logIndex)),
  });
}

function sourceMarketKey(market) {
  return `${market.kind || 'unknown'}:${String(market.sourceId || market.tokenAddress || market.poolId || '').toLowerCase()}`;
}

export function parseV4FunMarkets(html) {
  if (typeof html !== 'string') throw new Error('v4fun_schema_invalid');
  const markets = [];
  const seen = new Set();
  const pattern = /href=["']\/(tokens|markets)\/(0x[0-9a-f]{40})["'?#]/gi;
  for (const match of html.matchAll(pattern)) {
    const address = match[2].toLowerCase();
    const kind = match[1].toLowerCase() === 'tokens' ? 'classic' : 'programmable';
    const key = `${kind}:${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    markets.push({ sourceId: address, kind, tokenAddress: kind === 'classic' ? address : null });
  }
  return markets;
}

export function parseV4FunTotals(html) {
  if (typeof html !== 'string') return { classic: null, programmable: null };
  const total = (name) => {
    const match = new RegExp(`${name}Total[^:]{0,8}:\\s*(\\d+)`, 'i').exec(html);
    return match ? Number(match[1]) : null;
  };
  return { classic: total('classic'), programmable: total('programmable') };
}

export function classifyBlockscoutBatch(logs, targetBlock) {
  if (!Array.isArray(logs) || !Number.isSafeInteger(targetBlock)) throw new Error('blockscout_schema_invalid');
  if (logs.length < 1000) {
    return {
      state: 'BLOCKSCOUT_COMPLETE_THROUGH_TARGET',
      committedThrough: targetBlock,
      pendingFrom: null,
      targetBlock,
      capped: false,
    };
  }
  const boundaryBlock = Number(BigInt(logs.at(-1).blockNumber));
  return {
    state: 'PARTIAL_THROUGH_BLOCK',
    committedThrough: boundaryBlock - 1,
    pendingFrom: boundaryBlock,
    targetBlock,
    capped: true,
  };
}

function eventTokenCandidates(event) {
  return [event.poolKey.currency0, event.poolKey.currency1].filter((address) => address !== ZERO_ADDRESS);
}

function sourceExecution() {
  return { adapter: null, status: 'blocked', reason: 'pool_key_unverified' };
}

function eventMarket(event, metadata = null) {
  return {
    id: event.poolId,
    poolId: event.poolId,
    tokenAddress: metadata?.tokenAddress || null,
    name: metadata?.name || null,
    symbol: metadata?.symbol || null,
    kind: metadata?.kind || 'uniswap_v4',
    sourceId: metadata?.sourceId || null,
    poolKey: event.poolKey,
    execution: classifyMarket(event.poolKey),
    evidence: {
      poolManagerInitialize: true,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      v4fun: Boolean(metadata),
    },
  };
}

export function buildMarketCatalog({ v4fun, blockscout, observedAt = new Date().toISOString() }) {
  const events = Array.isArray(blockscout?.events) ? blockscout.events : [];
  const sourceMarkets = Array.isArray(v4fun?.markets) ? v4fun.markets : [];
  const unmatchedEvents = new Map(events.map((event) => [event.poolId.toLowerCase(), event]));
  const markets = [];

  for (const metadata of sourceMarkets) {
    const token = normalizeAddress(metadata.tokenAddress);
    const claimedPool = typeof metadata.poolId === 'string' ? metadata.poolId.toLowerCase() : null;
    const candidates = events.filter((event) => (
      (claimedPool && event.poolId.toLowerCase() === claimedPool)
      || (token && eventTokenCandidates(event).includes(token))
    ));
    if (candidates.length === 1) {
      const event = candidates[0];
      unmatchedEvents.delete(event.poolId.toLowerCase());
      markets.push(eventMarket(event, { ...metadata, tokenAddress: token }));
    } else {
      markets.push({
        id: sourceMarketKey(metadata),
        poolId: null,
        tokenAddress: token,
        name: metadata.name || null,
        symbol: metadata.symbol || null,
        kind: metadata.kind || 'unknown',
        sourceId: metadata.sourceId || null,
        poolKey: null,
        execution: sourceExecution(),
        evidence: { poolManagerInitialize: false, v4fun: true },
      });
    }
  }

  for (const event of unmatchedEvents.values()) markets.push(eventMarket(event));

  const coverageState = blockscout?.state || 'PROVIDER_UNAVAILABLE';
  const eventCompleteness = coverageState === 'BLOCKSCOUT_COMPLETE_THROUGH_TARGET'
    && blockscout?.committedThrough === blockscout?.targetBlock;
  const status = coverageState === 'PROVIDER_UNAVAILABLE'
    ? 'provider_unavailable'
    : eventCompleteness ? 'complete_through_target' : 'partial';

  return {
    status,
    observedAt,
    coverage: {
      state: coverageState,
      deploymentBlock: blockscout?.deploymentBlock ?? 9070,
      observedHead: blockscout?.observedHead ?? null,
      targetBlock: blockscout?.targetBlock ?? null,
      committedThrough: blockscout?.committedThrough ?? null,
      recentWindow: blockscout?.recentWindow ?? null,
      eventCompleteness,
    },
    sources: {
      v4fun: {
        status: v4fun?.status || 'provider_unavailable',
        observedAt: v4fun?.observedAt || null,
        totals: v4fun?.totals || { classic: null, programmable: null },
        discovered: v4fun?.discovered || { classic: 0, programmable: 0 },
      },
      blockscout: { status, observedAt: blockscout?.observedAt || null },
    },
    markets,
  };
}

const DISCOVERY_BLOCK = 9070;
const FINALITY_DEPTH = 64;
const RECENT_LOG_PAGES = 4;
const CACHE_TTL_MS = 5 * 60_000;
let catalogCache = null;

async function fetchWithTimeout(fetchImpl, url, type) {
  const response = await fetchImpl(url, {
    headers: { accept: type === 'json' ? 'application/json' : 'text/html' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('provider_unavailable');
  return type === 'json' ? response.json() : response.text();
}

function blockNumberOf(item) {
  const value = item?.height ?? item?.number ?? item?.block_number;
  const number = typeof value === 'string' && value.startsWith('0x') ? Number(BigInt(value)) : Number(value);
  if (!Number.isSafeInteger(number) || number < DISCOVERY_BLOCK) throw new Error('blockscout_schema_invalid');
  return number;
}

export function normalizeBlockscoutV2Log(log) {
  const address = typeof log?.address === 'string' ? log.address : log?.address?.hash;
  if (typeof address !== 'string' || !Array.isArray(log?.topics) || typeof log?.data !== 'string') {
    throw new Error('blockscout_schema_invalid');
  }
  const blockNumber = blockNumberOf(log);
  const logIndex = Number(log.index);
  if (!Number.isSafeInteger(logIndex) || logIndex < 0 || typeof log.transaction_hash !== 'string') {
    throw new Error('blockscout_schema_invalid');
  }
  return {
    address,
    blockNumber: String(blockNumber),
    logIndex: String(logIndex),
    transactionHash: log.transaction_hash,
    topics: log.topics,
    data: log.data,
  };
}

async function readV4Fun(fetchImpl, baseUrl, observedAt) {
  try {
    const root = baseUrl.replace(/\/$/, '');
    const [home, classicPage, programmablePage] = await Promise.all([
      fetchWithTimeout(fetchImpl, `${root}/`, 'html'),
      fetchWithTimeout(fetchImpl, `${root}/tokens`, 'html'),
      fetchWithTimeout(fetchImpl, `${root}/markets`, 'html'),
    ]);
    const markets = parseV4FunMarkets(`${classicPage}\n${programmablePage}`);
    if (markets.length === 0) throw new Error('v4fun_schema_invalid');
    const totals = parseV4FunTotals(home);
    const discovered = {
      classic: markets.filter((market) => market.kind === 'classic').length,
      programmable: markets.filter((market) => market.kind === 'programmable').length,
    };
    const complete = totals.classic !== null && totals.programmable !== null
      && discovered.classic >= totals.classic && discovered.programmable >= totals.programmable;
    return { status: complete ? 'live' : 'partial', observedAt, totals, discovered, markets };
  } catch {
    return {
      status: 'provider_unavailable',
      observedAt,
      totals: { classic: null, programmable: null },
      discovered: { classic: 0, programmable: 0 },
      markets: [],
    };
  }
}

async function readRecentBlockscoutLogs(fetchImpl, root, targetBlock) {
  const normalized = [];
  let cursor = { topic: INITIALIZE_TOPIC };
  let cursorComplete = false;
  let pagesFetched = 0;
  for (let page = 0; page < RECENT_LOG_PAGES; page += 1) {
    const query = new URLSearchParams(Object.entries(cursor).map(([key, value]) => [key, String(value)]));
    const body = await fetchWithTimeout(fetchImpl, `${root}/api/v2/addresses/${POOL_MANAGER}/logs?${query}`, 'json');
    if (!Array.isArray(body?.items)) throw new Error('blockscout_schema_invalid');
    for (const item of body.items) {
      const log = normalizeBlockscoutV2Log(item);
      const block = Number(log.blockNumber);
      if (block > targetBlock) continue;
      if (normalizeAddress(log.address) !== POOL_MANAGER || log.topics?.[0]?.toLowerCase() !== INITIALIZE_TOPIC) {
        throw new Error('blockscout_schema_invalid');
      }
      normalized.push(log);
    }
    pagesFetched += 1;
    if (!body.next_page_params) {
      cursorComplete = true;
      break;
    }
    cursor = body.next_page_params;
  }
  const blocks = normalized.map((log) => Number(log.blockNumber));
  return {
    logs: normalized,
    pagesFetched,
    cursorComplete,
    newestBlock: blocks.length ? Math.max(...blocks) : null,
    oldestBlock: blocks.length ? Math.min(...blocks) : null,
  };
}

async function readBlockscout(fetchImpl, baseUrl, observedAt) {
  const root = baseUrl.replace(/\/$/, '');
  let observedHead = null;
  let targetBlock = null;
  try {
    const headBody = await fetchWithTimeout(fetchImpl, `${root}/api/v2/blocks?type=block`, 'json');
    observedHead = blockNumberOf(headBody?.items?.[0]);
    targetBlock = Math.max(DISCOVERY_BLOCK, observedHead - FINALITY_DEPTH);
  } catch {
    return {
      state: 'PROVIDER_UNAVAILABLE',
      deploymentBlock: DISCOVERY_BLOCK,
      observedHead: null,
      targetBlock: null,
      committedThrough: null,
      recentWindow: null,
      observedAt,
      events: [],
    };
  }

  let prefix = null;
  try {
    const query = new URLSearchParams({
      module: 'logs',
      action: 'getLogs',
      fromBlock: String(DISCOVERY_BLOCK),
      toBlock: String(targetBlock),
      address: POOL_MANAGER,
      topic0: INITIALIZE_TOPIC,
    });
    const body = await fetchWithTimeout(fetchImpl, `${root}/api?${query}`, 'json');
    if (!Array.isArray(body?.result) || (body.status !== '1' && body.message !== 'OK')) throw new Error('provider_unavailable');
    let prior = DISCOVERY_BLOCK;
    for (const log of body.result) {
      const block = Number(BigInt(log.blockNumber));
      if (block < prior || block < DISCOVERY_BLOCK || block > targetBlock) throw new Error('blockscout_schema_invalid');
      if (normalizeAddress(log.address) !== POOL_MANAGER || log.topics?.[0]?.toLowerCase() !== INITIALIZE_TOPIC) throw new Error('blockscout_schema_invalid');
      prior = block;
    }
    const coverage = classifyBlockscoutBatch(body.result, targetBlock);
    prefix = {
      ...coverage,
      logs: coverage.capped
        ? body.result.filter((log) => Number(BigInt(log.blockNumber)) <= coverage.committedThrough)
        : body.result,
    };
  } catch {
    prefix = null;
  }

  let recent = null;
  try {
    recent = await readRecentBlockscoutLogs(fetchImpl, root, targetBlock);
  } catch {
    recent = null;
  }

  if (!prefix && !recent) {
    return {
      state: 'PROVIDER_UNAVAILABLE',
      deploymentBlock: DISCOVERY_BLOCK,
      observedHead,
      targetBlock,
      committedThrough: null,
      recentWindow: null,
      observedAt,
      events: [],
    };
  }

  const seen = new Set();
  const events = [];
  for (const log of [...(prefix?.logs || []), ...(recent?.logs || [])]) {
    const key = `${log.transactionHash?.toLowerCase()}:${Number(BigInt(log.logIndex))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(decodeInitializeLog(log));
  }

  const prefixComplete = prefix?.state === 'BLOCKSCOUT_COMPLETE_THROUGH_TARGET';
  const state = prefixComplete
    ? 'BLOCKSCOUT_COMPLETE_THROUGH_TARGET'
    : prefix && recent ? 'PARTIAL_PREFIX_AND_RECENT_WINDOW'
      : prefix ? prefix.state
        : 'RECENT_WINDOW_ONLY';
  return {
    state,
    deploymentBlock: DISCOVERY_BLOCK,
    observedHead,
    targetBlock,
    committedThrough: prefix?.committedThrough ?? null,
    recentWindow: recent ? {
      oldestBlock: recent.oldestBlock,
      newestBlock: recent.newestBlock,
      eventCount: recent.logs.length,
      pagesFetched: recent.pagesFetched,
      cursorComplete: recent.cursorComplete,
    } : null,
    observedAt,
    events,
  };
}

export async function discoverMarketCatalog(env = {}, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const observedAt = new Date(now()).toISOString();
  const cacheKey = `${env.V4FUN_URL || 'https://v4.fun'}|${env.BLOCKSCOUT_URL || 'https://robinhoodchain.blockscout.com'}`;
  if (!dependencies.fetchImpl && catalogCache?.key === cacheKey && now() - catalogCache.at < CACHE_TTL_MS) {
    return catalogCache.value;
  }
  const fetchImpl = dependencies.fetchImpl || fetch;
  const [v4fun, blockscout] = await Promise.all([
    readV4Fun(fetchImpl, env.V4FUN_URL || 'https://v4.fun', observedAt),
    readBlockscout(fetchImpl, env.BLOCKSCOUT_URL || 'https://robinhoodchain.blockscout.com', observedAt),
  ]);
  const value = buildMarketCatalog({ v4fun, blockscout, observedAt });
  if (!dependencies.fetchImpl) catalogCache = { key: cacheKey, at: now(), value };
  return value;
}
