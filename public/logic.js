import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem';

const PINNED_ROUTER = '0xcaf681a66d020601342297493863e78c959e5cb2';
const PINNED_WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const PINNED_USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const PINNED_FEE = 100;
const OUTER_ABI = parseAbi(['function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)']);
const SWAP_ABI = parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)']);

function decodeAndValidateCalldata(quote, account) {
  try {
    const outer = decodeFunctionData({ abi: OUTER_ABI, data: quote.data });
    if (outer.functionName !== 'multicall' || outer.args[1].length !== 1) return false;
    const canonical = encodeFunctionData({ abi: OUTER_ABI, functionName: 'multicall', args: outer.args });
    if (canonical.toLowerCase() !== quote.data.toLowerCase()) return false;

    const [deadline, calls] = outer.args;
    if (deadline !== BigInt(quote.deadline)
      || deadline !== BigInt(Math.floor(Number(quote.expiresAt) / 1000))) return false;

    const swap = decodeFunctionData({ abi: SWAP_ABI, data: calls[0] });
    if (swap.functionName !== 'exactInputSingle') return false;
    const nestedCanonical = encodeFunctionData({ abi: SWAP_ABI, functionName: 'exactInputSingle', args: swap.args });
    if (nestedCanonical.toLowerCase() !== calls[0].toLowerCase()) return false;

    const params = swap.args[0];
    return params.tokenIn.toLowerCase() === PINNED_WETH
      && params.tokenOut.toLowerCase() === PINNED_USDG
      && Number(params.fee) === PINNED_FEE
      && params.recipient.toLowerCase() === account.toLowerCase()
      && params.amountIn === BigInt(quote.amountIn)
      && params.amountIn === BigInt(quote.value)
      && params.amountOutMinimum === BigInt(quote.minimumOut)
      && params.sqrtPriceLimitX96 === 0n;
  } catch {
    return false;
  }
}

export function isQuoteExecutable(quote, context) {
  if (!quote || !context.account) return false;
  try {
    const slippageBps = Number(quote.slippageBps);
    const expectedOut = BigInt(quote.expectedOut);
    const minimumOut = BigInt(quote.minimumOut);
    const boundedOutput = Number.isInteger(slippageBps)
      && slippageBps >= 10
      && slippageBps <= 500
      && expectedOut > 0n
      && minimumOut === expectedOut * BigInt(10_000 - slippageBps) / 10_000n;
    return Boolean(
      Number(quote.chainId) === Number(context.chainId)
      && quote.from?.toLowerCase() === context.account.toLowerCase()
      && quote.to?.toLowerCase() === PINNED_ROUTER
      && quote.tokenIn === 'ETH'
      && quote.tokenOut === 'USDG'
      && boundedOutput
      && BigInt(quote.value) === BigInt(quote.amountIn)
      && Number(context.now) < Number(quote.expiresAt)
      && typeof quote.data === 'string'
      && /^0x[0-9a-f]+$/i.test(quote.data)
      && decodeAndValidateCalldata(quote, context.account)
    );
  } catch {
    return false;
  }
}

export function walletConnectionGuidance(error) {
  if (error?.code === 4001) return 'Wallet connection rejected.';
  if (error?.message === 'wallet_not_found') {
    return 'No compatible wallet was detected. Open Verity inside your wallet browser or use a desktop browser with an injected wallet extension. WalletConnect is not available yet.';
  }
  return 'Unable to connect a compatible EIP-1193 wallet. Check that the wallet is unlocked, then try again.';
}

export function shouldCompactNav(compact, scrollPosition) {
  const y = Math.max(0, Number(scrollPosition) || 0);
  return compact ? y > 16 : y >= 80;
}

export function createExecutionLock() {
  let active = false;
  return Object.freeze({
    inFlight: () => active,
    async run(operation) {
      if (active) return null;
      active = true;
      try { return await operation(); }
      finally { active = false; }
    },
  });
}

export function toRpcTransaction(quote) {
  return {
    from: quote.from,
    to: quote.to,
    value: `0x${BigInt(quote.value).toString(16)}`,
    data: quote.data,
  };
}

export function formatUnits(raw, decimals, precision = 4) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Not connected';
}
