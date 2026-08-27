export async function validatedRpcRequest(provider, expectedChainId, method, params = [], options = {}) {
  const chain = await rpcRequest([provider], 'eth_chainId', [], options);
  if (Number(BigInt(chain.value)) !== Number(expectedChainId)) {
    const error = new Error('provider_chain_mismatch');
    error.code = 'provider_chain_mismatch';
    error.status = 502;
    throw error;
  }
  return rpcRequest([provider], method, params, options);
}

export async function rpcRequest(urls, method, params = [], options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 4_000;

  for (const provider of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('rpc_timeout'), timeoutMs);
    try {
      const response = await fetchImpl(provider, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'origin': 'https://robinhood-execution-terminal.app',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('rpc_http_error');
      const body = await response.json();
      if (body?.error || body?.result === undefined) throw new Error('rpc_response_error');
      return { value: body.result, provider };
    } catch {
      // Try the next provider. Provider details are intentionally not exposed.
    } finally {
      clearTimeout(timer);
    }
  }

  const error = new Error('provider_unavailable');
  error.code = 'provider_unavailable';
  error.status = 502;
  throw error;
}
