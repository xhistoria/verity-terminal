import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, maxUint256, parseAbi, zeroAddress } from 'viem';

export const V4_POLICY = Object.freeze({
  protocol: 'uniswap_v4',
  routerVersion: '2.1.1',
  router: '0x06afBA43fd06227fA663b0dAeCF536F6eaA6BF99',
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  quoter: '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94',
  stateView: '0xF3334192D15450CDD385c8B70e03f9a6bD9E673b',
  poolId: '0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982',
  poolKey: Object.freeze({
    currency0: zeroAddress,
    currency1: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    fee: 500,
    tickSpacing: 10,
    hooks: zeroAddress,
  }),
  command: '0x10',
  actions: '0x060c0f',
  runtimeCodeHashes: Object.freeze({
    router: '0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5',
    poolManager: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626',
    quoter: '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6',
    stateView: '0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6',
  }),
});

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes commands,bytes[] inputs,uint256 deadline) payable',
]);
export const V4_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)',
]);

const POOL_KEY = [{
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
}];

export function computeV4PoolId(poolKey) {
  return keccak256(encodeAbiParameters(POOL_KEY, [poolKey]));
}

if (computeV4PoolId(V4_POLICY.poolKey) !== V4_POLICY.poolId) {
  throw new Error('v4_pool_id_mismatch');
}

const SWAP_EXACT_IN_SINGLE = [{
  type: 'tuple',
  components: [
    {
      name: 'poolKey',
      type: 'tuple',
      components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
    },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountIn', type: 'uint128' },
    { name: 'amountOutMinimum', type: 'uint128' },
    { name: 'minHopPriceX36', type: 'uint256' },
    { name: 'hookData', type: 'bytes' },
  ],
}];
const PLAN = [{ type: 'bytes' }, { type: 'bytes[]' }];
const PAYMENT = [{ type: 'address' }, { type: 'uint256' }];

export function encodeV4ExactIn({ amountIn, minimumOut, deadline }) {
  const swap = encodeAbiParameters(SWAP_EXACT_IN_SINGLE, [{
    poolKey: V4_POLICY.poolKey,
    zeroForOne: true,
    amountIn,
    amountOutMinimum: minimumOut,
    minHopPriceX36: 0n,
    hookData: '0x',
  }]);
  const settleAll = encodeAbiParameters(
    PAYMENT,
    [zeroAddress, maxUint256],
  );
  const takeAll = encodeAbiParameters(
    PAYMENT,
    [V4_POLICY.poolKey.currency1, minimumOut],
  );
  const plan = encodeAbiParameters(
    PLAN,
    [V4_POLICY.actions, [swap, settleAll, takeAll]],
  );
  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [V4_POLICY.command, [plan], BigInt(deadline)],
  });
}

export function decodeV4ExactIn(data) {
  const outer = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data });
  if (outer.functionName !== 'execute' || outer.args[0] !== V4_POLICY.command || outer.args[1].length !== 1) {
    throw new Error('v4_outer_policy_mismatch');
  }
  const [actions, params] = decodeAbiParameters(PLAN, outer.args[1][0]);
  if (actions !== V4_POLICY.actions || params.length !== 3) throw new Error('v4_action_policy_mismatch');
  const swap = decodeAbiParameters(SWAP_EXACT_IN_SINGLE, params[0])[0];
  const settle = decodeAbiParameters(PAYMENT, params[1]);
  const take = decodeAbiParameters(PAYMENT, params[2]);
  if (settle[0] !== zeroAddress || settle[1] !== maxUint256
    || take[0].toLowerCase() !== V4_POLICY.poolKey.currency1.toLowerCase()
    || take[1] !== swap.amountOutMinimum) {
    throw new Error('v4_settlement_policy_mismatch');
  }
  const canonical = encodeV4ExactIn({
    amountIn: swap.amountIn,
    minimumOut: swap.amountOutMinimum,
    deadline: outer.args[2],
  });
  if (canonical.toLowerCase() !== data.toLowerCase()) throw new Error('v4_calldata_not_canonical');
  return Object.freeze({
    amountIn: swap.amountIn,
    minimumOut: swap.amountOutMinimum,
    deadline: outer.args[2],
  });
}
