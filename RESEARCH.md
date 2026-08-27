# Robinhood Chain Execution Terminal — Research Decision

**Date:** 2026-08-27
**Status:** Constrained Uniswap v4 implementation and live quote/full simulation verified; user-approved broadcast and settlement remain unverified.
**Boundary:** Standalone product. Runtime release state, live simulation, and receipt evidence are reported separately.

## Decision

Build a **non-custodial social execution terminal** for Robinhood Chain, not a generic swap clone and not a server-custodied X/Telegram trading bot.

**Positioning:**

> Follow on-chain events, understand the evidence, simulate the exact trade, and execute with explicit user-controlled limits.

The product combines discovery, explainable evidence, quote/simulation, local wallet signing, and settlement receipts. Every trade starts as a user-confirmed action. Unattended policy-limited automation is an expansion feature only after security and execution-quality evidence.

## What is verified

### Uniswap v4 implementation addendum

The execution implementation now pins the Robinhood Chain Universal Router v2.1.1 (`0x06afBA43fd06227fA663b0dAeCF536F6eaA6BF99`), PoolManager, V4Quoter, StateView, and the hookless native ETH/USDG PoolKey. The full PoolKey hashes to pool ID `0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982` with fee `500`, tick spacing `10`, and the zero hook address.

Read-only mainnet validation reproduced V4Quoter output and successfully executed the complete `V4_SWAP → SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE_ALL` plan through `eth_estimateGas`/simulation. Runtime bytecode hashes matched the source pins. These checks used no wallet signature and returned `broadcasted: false`.

There is **no user-approved v4 transaction hash or successful v4 receipt**. The older SwapRouter02 observation below remains historical v3 deployment evidence only and must not be treated as proof of v4 settlement.

Robinhood Chain mainnet is EVM-compatible, chain ID `4663`; testnet is `46630`. Official docs publish RPC, sequencer, wallet, gas, finality, Stock Token API, and account-abstraction information.[22][25][26][27][28][29][30]

The official public RPC is useful for development but is rate-limited and not suitable as the sole production provider. Production needs authenticated RPC redundancy and health-based failover.[22]

The chain supports standard EVM wallet flows. We will implement EIP-6963 provider discovery and EIP-1193 provider handling, including account/chain changes and rejected requests.[31][34]

Robinhood documents multiple liquidity models for Stock Tokens: RFQ aggregators, AMMs such as Uniswap, proprietary AMMs such as Rialto, and Lighter orderbook markets.[26] This does **not** prove quote availability for every asset or establish one canonical router.

Blockscout currently identifies a verified Uniswap `SwapRouter02` at `0xCaf681a66D020601342297493863E78C959E5cb2`. A production transaction using `exactInputSingle` was observed successfully during research. This proves observed deployment/use, not universal route safety or liquidity.[unverified]

The official documentation does not provide one canonical swap-router address for all execution. Therefore router, factory, quoter, settlement target, spender, and token addresses must be versioned and independently validated before signing.[26]

Robinhood documents staged settlement: sequencer soft confirmation, batch posting, and later Ethereum finality. The product must display these separately; a receipt is not equivalent to L1 finality.[23][24]

A public sequencer feed is a latency signal for ordered/calldata visibility, not execution proof. We must reconcile it against receipts and handle reorg/replacement states.[unverified]

## Competitor conclusion

- Pons Bot wins on X distribution and low-friction commands, but its public materials do not establish a user-controlled external-wallet signing model.[3]
- Nock combines Robinhood-native discovery, wallet analytics, and bot execution; its public bot fee is 1%.[4]
- Factor demonstrates browser-local encrypted-key execution and simulation-first UX.[5]
- Maestro and Banana Gun demonstrate demand for automation/copytrade, but their operational signing capability and key exposure create a materially higher trust boundary.[6][7][8][9][10][11]
- MetaMask demonstrates the wallet-native route-and-sign pattern, with a disclosed app fee separate from gas and other costs.[12]

A clone would compete on commodity routing. The defensible wedge is an auditable chain:

`event → evidence/counter-evidence → simulated follower outcome → bounded execution → attributed receipt`

## MVP scope

### Include

1. EIP-6963 wallet discovery and EIP-1193 connection.
2. Chain 4663 validation and network switching.
3. Native ETH and allowlisted ERC-20 balances.
4. Official Stock Token API as a metadata universe, never as proof of executable liquidity.[28]
5. One venue adapter with chain-specific quote/settlement documentation.
6. Exact calldata preview: token, amount, spender/router, recipient, route, expected output, guaranteed minimum, expiry, price impact, fees, and gas.
7. Exact approval or Permit2 only when spender/domain/deadline are validated.[32]
8. `eth_call`/`eth_estimateGas` simulation; richer simulation where authenticated infrastructure supports it.[34]
9. Local wallet signing and direct broadcast.
10. Receipt and finality tracking with explorer links.
11. Explicit state machine: `draft`, `quoted`, `quote_expired`, `simulation_failed`, `awaiting_signature`, `signature_rejected`, `broadcasted`, `pending`, `confirmed`, `reverted`, `replaced`, `reorged`, `unknown`.
12. Transaction history and shareable audit receipt.

### Exclude from MVP

- Private-key or seed-phrase import/upload.
- Server-held keys or unattended signing.
- Arbitrary contract/router calls.
- Stock Tokens/RWAs until jurisdiction and transfer restrictions are encoded and reviewed.[29][35][36][37][38]
- Copytrading that executes without confirmation.
- Token launches, volume generation, sniping, sandwich/MEV claims, and natural-language transaction commands.
- Cross-chain execution.

## Security release gates

- Exact chain and contract allowlists; versioned changes.
- Two production RPC providers plus independent explorer/indexing path.
- Simulation with exact `from`, `to`, `value`, calldata, and latest practical state.
- Decode balance/allowance/fee-recipient deltas; block unexplained transfers.
- On-chain `amountOutMinimum` and short deadline.
- Exact approvals by default; no silent unlimited fallback.
- Re-check account, chain, quote, route, and limits immediately before signing.
- Sanctions/geography policy and initial jurisdiction allowlist reviewed by qualified counsel; “non-custodial” is not a global legal exemption.[35][36][37][38]
- Kill switch, provider health, denylist, incident runbook, audit logs, and public security contact.

## Feasibility gates before public beta

1. Testnet wallet connection and chain switching work across at least two EVM wallets.
2. One allowlisted token has a quote that can be reproduced onchain.
3. Approval and swap simulation decode expected deltas.
4. A small controlled testnet transaction reaches receipt and correct finality states.
5. A small controlled mainnet transaction is executed only after explicit user approval and simulation, with tx hash/receipt/gas recorded.
6. p95 quote/simulation latency, RPC error rate, receipt latency, reconnect success, and stale-state visibility are measured.
7. No trade is labelled successful from a broadcast hash alone.

## Product and business path

- Free: wallet connect, balances, basic quotes, receipts.
- Pro: advanced wallet/event monitoring, historical execution analytics, policy templates, exports/API.
- Execution fee: transparent, successful-trade-only basis points, itemized separately from gas, pool/venue, routing, and price impact. Exact rate requires venue/legal/economics validation.
- Later: alerts, one-tap confirmed mirroring, limit/TP/SL, revocable session policies, private communities, strategy templates, and B2B execution API.

## Main risks

- Router/venue coverage and provider dependency.
- Thin liquidity, stale quotes, transfer taxes/hooks, and adverse execution.
- Wallet phishing, malicious approval, compromised frontend, and session-key overreach.
- Social manipulation, wash-traded leaders, paid rankings, and followers becoming exit liquidity.
- Securities/RWA restrictions and jurisdiction-specific obligations.
- False affiliation with Robinhood; product branding must be independent.

## Immediate implementation plan

1. Create a standalone repository with a provider abstraction, chain config, allowlists, and no secrets.
2. Add TDD tests for chain config, wallet events, quote validation, simulation decoding, state transitions, and receipt reconciliation.
3. Build a testnet-only vertical slice.
4. Verify one real small transaction under explicit approval.
5. Add discovery/social evidence only after the execution core is reliable.

## Sources

[3] https://www.ponsbot.family/how-it-works
[4] https://nockterminal.com
[5] https://winwithfactor.io/terminal
[6] https://docs.maestrobots.com/sniper/faq/fees.md
[7] https://docs.maestrobots.com/sniper/faq/security.md
[8] https://docs.maestrobots.com/sniper/copytrade/index.md
[9] https://docs.bananagun.io/welcome.md
[10] https://banana-gun.gitbook.io/banana-gun/get-started/wallet-setup.md
[11] https://banana-gun.gitbook.io/banana-pro/banana-pro/copy-trade/copy-trade-overview.md
[12] https://support.metamask.io/trade/swap/user-guide-swaps
[22] https://docs.robinhood.com/chain/connecting
[23] https://docs.robinhood.com/chain/transaction-finality
[24] https://docs.robinhood.com/chain/differences-from-ethereum
[25] https://docs.robinhood.com/chain/add-network-to-wallet
[26] https://docs.robinhood.com/chain/building-with-stock-tokens
[27] https://docs.robinhood.com/chain/gas-and-fees
[28] https://docs.robinhood.com/chain/stock-token-apis
[29] https://docs.robinhood.com/chain/stock-tokens
[30] https://docs.robinhood.com/chain/account-abstraction
[31] https://eips.ethereum.org/EIPS/eip-712
[32] https://eips.ethereum.org/EIPS/eip-2612
[34] https://eips.ethereum.org/EIPS/eip-5792
[35] https://ofac.treasury.gov/media/913571/download?inline
[36] https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf
[37] https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html
[38] https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng

> Legal note: this is engineering/product research, not legal advice or a determination that launch is permitted in any jurisdiction.
