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
  assert.match(quote.data, /^0x5ae401dc[0-9a-f]+$/i);
  assert.equal(quote.deadline, 1060);
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
