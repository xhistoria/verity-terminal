import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';
import { createBuyQuote } from '../src/quote.js';
import { createExecutionLock, formatUnits, isQuoteExecutable, shouldCompactNav, toRpcTransaction, walletConnectionGuidance } from '../public/logic.js';

const account = '0x0b95bDa3F7B92eA874D060B5485eFa55a19B5448';
const other = '0x0000000000000000000000000000000000000001';
const outerAbi = parseAbi(['function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)']);
const swapAbi = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)']);
const quote = await createBuyQuote(
  { wallet: account, amount: '0.001', slippageBps: 50 },
  { simulate: async () => 2_500_000n, now: () => 1_000 },
);
const context = { account, chainId: 4663, now: 1_999 };

function mutateCalldata(mutator, options = {}) {
  const outer = decodeFunctionData({ abi: outerAbi, data: quote.data });
  const inner = decodeFunctionData({ abi: swapAbi, data: outer.args[1][0] });
  const params = { ...inner.args[0] };
  mutator(params);
  const nested = encodeFunctionData({ abi: swapAbi, functionName: 'exactInputSingle', args: [params] });
  const calls = options.extraCall ? [nested, nested] : [nested];
  return encodeFunctionData({
    abi: outerAbi,
    functionName: 'multicall',
    args: [options.deadline ?? outer.args[0], calls],
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
    (p) => { p.tokenIn = other; },
    (p) => { p.tokenOut = other; },
    (p) => { p.fee = 500; },
    (p) => { p.recipient = other; },
    (p) => { p.amountIn += 1n; },
    (p) => { p.amountOutMinimum += 1n; },
    (p) => { p.sqrtPriceLimitX96 = 1n; },
  ];
  for (const mutate of mutations) {
    assert.equal(isQuoteExecutable({ ...quote, data: mutateCalldata(mutate) }, context), false);
  }
  assert.equal(isQuoteExecutable({ ...quote, data: mutateCalldata(() => {}, { extraCall: true }) }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, data: mutateCalldata(() => {}, { deadline: 999n }) }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, data: `${quote.data}00` }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, data: '0x5ae401dc' }, context), false);
});

test('rejects mutated metadata, router, value, and minimum output', () => {
  assert.equal(isQuoteExecutable({ ...quote, to: other }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, value: '2' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, tokenOut: 'OTHER' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, minimumOut: '1' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, expectedOut: '999999999' }, context), false);
  assert.equal(isQuoteExecutable({ ...quote, slippageBps: 501 }, context), false);
});

test('wallet connection failures explain the actual supported path', () => {
  assert.match(walletConnectionGuidance({ message: 'wallet_not_found' }), /wallet browser/i);
  assert.match(walletConnectionGuidance({ message: 'wallet_not_found' }), /WalletConnect is not available/i);
  assert.equal(walletConnectionGuidance({ code: 4001 }), 'Wallet connection rejected.');
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

test('builds an exact wallet transaction without adding permissions', () => {
  assert.deepEqual(toRpcTransaction(quote), {
    from: account,
    to: quote.to,
    value: '0x38d7ea4c68000',
    data: quote.data,
  });
});

test('formats token amounts without floating-point conversion', () => {
  assert.equal(formatUnits('2494964', 6, 4), '2.4949');
  assert.equal(formatUnits('1000000', 6, 4), '1');
});
