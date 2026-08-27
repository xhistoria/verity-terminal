# Next

## Immediate feasibility spike

- [ ] Confirm official RPC methods on mainnet and testnet with authenticated-provider plan.
- [ ] Confirm wallet connection and chain switching with two EVM wallets.
- [ ] Build chain config and versioned token/venue allowlists.
- [ ] Obtain a chain-specific quote from one documented venue.
- [ ] Simulate exact approval and swap calldata; decode all balance/allowance/fee deltas.
- [ ] Build transaction state machine and receipt reconciliation.
- [ ] Run testnet vertical slice.
- [ ] Run a small mainnet transaction only after the previous gates pass and explicit user approval.
- [ ] Record latency, failure, stale-state, and reconnect metrics.

## Public beta gates

- [ ] Counsel-reviewed initial jurisdiction allowlist.
- [ ] Stock Tokens/RWAs excluded or policy-gated until reviewed.
- [ ] Two RPC providers and independent reconciliation path.
- [ ] Security review of frontend, dependencies, allowlists, and transaction decoder.
- [ ] Kill switch and incident runbook.
- [ ] Small cohort beta with no unattended automation.
