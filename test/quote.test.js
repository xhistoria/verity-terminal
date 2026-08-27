import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuyQuote } from '../src/quote.js';
import { CONTRACTS } from '../src/config.js';

const wallet = '0x0b95bDa3F7B92eA874D060B5485eFa55a19B5448';

test('creates bounded ETH to USDG calldata from a simulated output', async () => {
  const quote = await createBuyQuote(
    { wallet, amount: '0.001', slippageBps: 50 },
    { simulate: async () => ({ amountOut: 2_500_000n, blockNumber: 47_000_000, providerClass: 'public_rpc' }), now: () => 1_000_000 },
  );

  assert.equal(quote.chainId, 4663);
  assert.equal(quote.to.toLowerCase(), CONTRACTS.router.toLowerCase());
  assert.equal(quote.value, '1000000000000000');
  assert.equal(quote.expectedOut, '2500000');
  assert.equal(quote.minimumOut, '2487500');
  assert.equal(quote.expiresAt, 1_060_000);
  assert.match(quote.data, /^0x3593564c[0-9a-f]+$/i);
  assert.equal(quote.deadline, 1060);
  assert.equal(quote.protocol, 'uniswap_v4');
  assert.equal(quote.routerVersion, '2.1.1');
  assert.equal(quote.pool, '0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982');
  assert.equal(quote.hooks, '0x0000000000000000000000000000000000000000');
  assert.equal(quote.simulatedAtBlock, 47_000_000);
  assert.equal(quote.providerClass, 'public_rpc');
  assert.equal(quote.status, 'quoted');
});

test('rejects unsafe quote input before any provider call', async () => {
  let calls = 0;
  const simulate = async () => { calls += 1; return 1n; };

  await assert.rejects(
    createBuyQuote({ wallet, amount: '0', slippageBps: 50 }, { simulate }),
    /amount_out_of_range/,
  );
  await assert.rejects(
    createBuyQuote({ wallet, amount: '0.01', slippageBps: 1000 }, { simulate }),
    /slippage_out_of_range/,
  );
  await assert.rejects(
    createBuyQuote({ wallet: 'not-an-address', amount: '0.01', slippageBps: 50 }, { simulate }),
    /wallet_invalid/,
  );
  assert.equal(calls, 0);
});

test('fails closed when simulation returns no output', async () => {
  await assert.rejects(
    createBuyQuote(
      { wallet, amount: '0.001', slippageBps: 50 },
      { simulate: async () => 0n },
    ),
    /quote_unavailable/,
  );
});

test('fails closed when slippage flooring would remove output protection', async () => {
  await assert.rejects(
    createBuyQuote(
      { wallet, amount: '1', slippageBps: 500 },
      { simulate: async () => 1n, now: () => 1_000_000 },
    ),
    /quote_unavailable/,
  );
});
