import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, parseAbi } from 'viem';
import { assertV4CodeHashes, simulateBuyOnchain, simulateMarketQuoteOnchain } from '../src/onchain.js';
import { V4_POLICY } from '../shared/v4-policy.js';

const wallet = '0x0b95bDa3F7B92eA874D060B5485eFa55a19B5448';
const quoterAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)',
]);

test('quotes the exact pinned v4 PoolKey through V4Quoter at one validated block', async () => {
  const calls = [];
  let deploymentVerified = false;
  const rpcRequest = async (provider, chainId, method, params = []) => {
    calls.push({ provider, chainId, method, params });
    if (method === 'eth_blockNumber') return { value: '0x2dc6c00' };
    if (method === 'eth_call') {
      return { value: encodeFunctionResult({
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        result: [2_483_990n, 42_713n],
      }) };
    }
    throw new Error(`unexpected_method:${method}`);
  };

  const result = await simulateBuyOnchain({
    wallet,
    amountIn: 1_000_000_000_000_000n,
    poolKey: V4_POLICY.poolKey,
    zeroForOne: true,
    hookData: '0x',
  }, { RPC_URL: 'https://rpc.example', RPC_PROVIDER_CLASS: 'authenticated_rpc' }, {
    rpcRequest,
    verifyDeployments: async (provider) => {
      deploymentVerified = true;
      assert.equal(provider, 'https://rpc.example');
    },
  });

  assert.equal(result.amountOut, 2_483_990n);
  assert.equal(result.quoteGasEstimate, 42_713n);
  assert.equal(result.blockNumber, 48_000_000);
  assert.equal(result.providerClass, 'authenticated_rpc');
  assert.equal(deploymentVerified, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'eth_call');
  assert.equal(calls[1].params[0].to.toLowerCase(), V4_POLICY.quoter.toLowerCase());
  assert.equal(calls[1].params[1], '0x2dc6c00');
  const decoded = decodeFunctionData({ abi: quoterAbi, data: calls[1].params[0].data });
  assert.deepEqual(decoded.args[0].poolKey, V4_POLICY.poolKey);
  assert.equal(decoded.args[0].zeroForOne, true);
  assert.equal(decoded.args[0].exactAmount, 1_000_000_000_000_000n);
  assert.equal(decoded.args[0].hookData, '0x');
});

test('generic market probe encodes the supplied canonical PoolKey instead of the legacy pinned route', async () => {
  const poolKey = { ...V4_POLICY.poolKey, currency1: '0x81990adb80b272c9c5b62cc2fc017ca9efe47777' };
  let callData;
  const rpcRequest = async (_provider, _chainId, method, params = []) => {
    if (method === 'eth_blockNumber') return { value: '0x2dc6c00' };
    if (method === 'eth_call') {
      callData = params[0].data;
      return { value: encodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', result: [77n, 88n] }) };
    }
    throw new Error(`unexpected_method:${method}`);
  };
  const result = await simulateMarketQuoteOnchain({ wallet, amountIn: 1n, poolKey, zeroForOne: true, hookData: '0x' }, { RPC_URL: 'https://rpc.example' }, {
    rpcRequest,
    verifyDeployments: async () => {},
  });
  assert.equal(result.amountOut, 77n);
  const decoded = decodeFunctionData({ abi: quoterAbi, data: callData });
  assert.equal(decoded.args[0].poolKey.currency0.toLowerCase(), poolKey.currency0.toLowerCase());
  assert.equal(decoded.args[0].poolKey.currency1.toLowerCase(), poolKey.currency1.toLowerCase());
  assert.equal(decoded.args[0].poolKey.hooks.toLowerCase(), poolKey.hooks.toLowerCase());
  assert.equal(decoded.args[0].poolKey.fee, poolKey.fee);
  assert.equal(decoded.args[0].poolKey.tickSpacing, poolKey.tickSpacing);
});

test('fails closed when any pinned v4 runtime code hash changes', () => {
  const hashes = { ...V4_POLICY.runtimeCodeHashes };
  assert.doesNotThrow(() => assertV4CodeHashes(hashes));
  hashes.router = `0x${'00'.repeat(32)}`;
  assert.throws(() => assertV4CodeHashes(hashes), /v4_deployment_hash_mismatch/);
});
