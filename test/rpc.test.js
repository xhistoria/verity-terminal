import test from 'node:test';
import assert from 'node:assert/strict';
import { rpcRequest, validatedRpcRequest } from '../src/rpc.js';

test('fails over to the next RPC provider', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://first.invalid') throw new Error('network down');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1237' }), {
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await rpcRequest(
    ['https://first.invalid', 'https://second.example'],
    'eth_chainId',
    [],
    { fetchImpl, timeoutMs: 100 },
  );

  assert.equal(result.value, '0x1237');
  assert.equal(result.provider, 'https://second.example');
  assert.deepEqual(calls, ['https://first.invalid', 'https://second.example']);
});

test('validated RPC rejects a provider on the wrong chain', async () => {
  const fetchImpl = async (_url, init) => {
    const method = JSON.parse(init.body).method;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: method === 'eth_chainId' ? '0x1' : '0x1234' }));
  };
  await assert.rejects(
    validatedRpcRequest('https://wrong-chain.example', 4663, 'eth_blockNumber', [], { fetchImpl }),
    (error) => error.code === 'provider_chain_mismatch',
  );
});

test('rejects JSON-RPC error responses and sanitizes provider failure', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'internal secret detail' },
  }));

  await assert.rejects(
    rpcRequest(['https://rpc.example'], 'eth_call', [], { fetchImpl, timeoutMs: 100 }),
    (error) => error.code === 'provider_unavailable' && !error.message.includes('secret'),
  );
});
