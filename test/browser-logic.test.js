import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, maxUint256 } from 'viem';
import { createBuyQuote } from '../src/quote.js';
import { createExecutionLock, createWalletContextGuard, formatUnits, isQuoteExecutable, shouldCompactNav, toRpcTransaction, walletConnectionGuidance } from '../public/logic.js';
import { encodeV4ExactIn, UNIVERSAL_ROUTER_ABI } from '../shared/v4-policy.js';

const account = '0x0b95bDa3F7B92eA874D060B5485eFa55a19B5448';
const other = '0x0000000000000000000000000000000000000001';
const planTypes = [{ type: 'bytes' }, { type: 'bytes[]' }];
const swapTypes = [{ type: 'tuple', components: [
  { name: 'poolKey', type: 'tuple', components: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
  ] },
  { name: 'zeroForOne', type: 'bool' }, { name: 'amountIn', type: 'uint128' },
  { name: 'amountOutMinimum', type: 'uint128' }, { name: 'minHopPriceX36', type: 'uint256' },
  { name: 'hookData', type: 'bytes' },
] }];
const paymentTypes = [{ type: 'address' }, { type: 'uint256' }];
const quote = await createBuyQuote(
  { wallet: account, amount: '0.001', slippageBps: 50 },
  { simulate: async () => 2_500_000n, now: () => 1_000 },
);
const context = { account, chainId: 4663, now: 1_999 };

function mutateCalldata(mutator) {
  const outer = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data: quote.data });
  const [actions, params] = decodeAbiParameters(planTypes, outer.args[1][0]);
  const swap = decodeAbiParameters(swapTypes, params[0])[0];
  const settle = [...decodeAbiParameters(paymentTypes, params[1])];
  const take = [...decodeAbiParameters(paymentTypes, params[2])];
  const decoded = {
    command: outer.args[0], deadline: outer.args[2], actions,
    swap: { ...swap, poolKey: { ...swap.poolKey } }, settle, take,
  };
  mutator(decoded);
  const encodedParams = [
    encodeAbiParameters(swapTypes, [decoded.swap]),
    encodeAbiParameters(paymentTypes, decoded.settle),
    encodeAbiParameters(paymentTypes, decoded.take),
  ];
  const plan = encodeAbiParameters(planTypes, [decoded.actions, encodedParams]);
  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [decoded.command, [plan], decoded.deadline],
  });
}

test('only executes a fully decoded fresh quote for the connected account and chain', () => {
  assert.equal(isQuoteExecutable(quote, context), true);
  assert.equal(isQuoteExecutable(quote, { ...context, now: quote.expiresAt }), false);
  assert.equal(isQuoteExecutable(quote, { ...context, account: other }), false);
  assert.equal(isQuoteExecutable(quote, { ...context, chainId: 1 }), false);
});

test('rejects every mutated nested execution field and extra multicall commands', () => {
  const mutations = [
    (p) => { p.command = '0x90'; },
    (p) => { p.actions = '0x060c'; },
    (p) => { p.deadline -= 1n; },
    (p) => { p.swap.poolKey.currency0 = other; },
    (p) => { p.swap.poolKey.currency1 = other; },
    (p) => { p.swap.poolKey.fee = 3000; },
    (p) => { p.swap.poolKey.tickSpacing = 60; },
    (p) => { p.swap.poolKey.hooks = other; },
    (p) => { p.swap.zeroForOne = false; },
    (p) => { p.swap.amountIn += 1n; },
    (p) => { p.swap.amountOutMinimum += 1n; },
    (p) => { p.swap.minHopPriceX36 = 1n; },
    (p) => { p.swap.hookData = '0x01'; },
    (p) => { p.settle[0] = other; },
    (p) => { p.settle[1] = maxUint256 - 1n; },
    (p) => { p.take[0] = other; },
    (p) => { p.take[1] += 1n; },
  ];
  for (const mutate of mutations) {
    assert.equal(isQuoteExecutable({ ...quote, data: mutateCalldata(mutate) }, context), false);
  }
  assert.equal(isQuoteExecutable({ ...quote, data: `${quote.data}00` }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, data: '0x3593564c' }, context), false);
});

test('rejects mutated metadata, router, value, and minimum output', () => {
  assert.equal(isQuoteExecutable({ ...quote, to: other }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, value: '2' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, tokenOut: 'OTHER' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, minimumOut: '1' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, expectedOut: '999999999' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, slippageBps: 501 }, context), false);
  const twoEth = 2n * 10n ** 18n;
  assert.equal(isQuoteExecutable({
    ...quote,
    amountIn: twoEth.toString(),
    value: twoEth.toString(),
    data: encodeV4ExactIn({ amountIn: twoEth, minimumOut: BigInt(quote.minimumOut), deadline: quote.deadline }),
  }, context), false);
  assert.equal(isQuoteExecutable({
    ...quote,
    expectedOut: '1',
    minimumOut: '0',
    slippageBps: 500,
    data: encodeV4ExactIn({ amountIn: BigInt(quote.amountIn), minimumOut: 0n, deadline: quote.deadline }),
  }, context), false);
  const longExpiry = quote.quotedAt + 365 * 24 * 60 * 60 * 1_000;
  assert.equal(isQuoteExecutable({
    ...quote,
    expiresAt: longExpiry,
    deadline: Math.floor(longExpiry / 1_000),
    data: encodeV4ExactIn({ amountIn: BigInt(quote.amountIn), minimumOut: BigInt(quote.minimumOut), deadline: Math.floor(longExpiry / 1_000) }),
  }, context), false);
});

test('wallet connection failures explain the actual supported path', () => {
  assert.match(walletConnectionGuidance({ message: 'wallet_not_found' }), /wallet browser/i);
  assert.match(walletConnectionGuidance({ message: 'wallet_not_found' }), /WalletConnect availability depends/i);
  assert.equal(walletConnectionGuidance({ code: 4001 }), 'Wallet connection rejected.');
  assert.equal(walletConnectionGuidance({ name: 'UserRejectedRequestError' }), 'Wallet connection rejected.');
  assert.match(walletConnectionGuidance({ message: 'wallet_connector_unavailable' }), /no longer available/i);
  assert.match(walletConnectionGuidance(new Error('other')), /compatible EIP-1193 wallet/i);
});

test('floating navigation uses hysteresis instead of flickering at one boundary', () => {
  assert.equal(shouldCompactNav(false, 79), false);
  assert.equal(shouldCompactNav(false, 80), true);
  assert.equal(shouldCompactNav(true, 17), true);
  assert.equal(shouldCompactNav(true, 16), false);
});

test('execution lock permits at most one concurrent wallet submission', async () => {
  let calls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const lock = createExecutionLock();
  const first = lock.run(async () => { calls += 1; await wait; return 'hash'; });
  const second = lock.run(async () => { calls += 1; return 'duplicate'; });
  assert.equal(await second, null);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 'hash');
  assert.equal(lock.inFlight(), false);
});

test('builds a chain-pinned wallet transaction without adding permissions', () => {
  assert.deepEqual(toRpcTransaction(quote, 4663), {
    from: account,
    to: quote.to,
    value: '0x38d7ea4c68000',
    data: quote.data,
    chainId: '0x1237',
  });
});

test('wallet context guard invalidates an already-open signature request', () => {
  const guard = createWalletContextGuard();
  const beforePrompt = guard.snapshot();
  assert.equal(guard.isCurrent(beforePrompt), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(beforePrompt), false);
  assert.equal(guard.snapshot(), beforePrompt + 1);
});

test('formats token amounts without floating-point conversion', () => {
  assert.equal(formatUnits('2494964', 6, 4), '2.4949');
  assert.equal(formatUnits('1000000', 6, 4), '1');
});
