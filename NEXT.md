# Next

## Implemented and independently exercised

- [x] Build chain config and versioned token/venue allowlists.
- [x] Obtain reproducible chain-specific v4 quotes from the pinned hookless pool.
- [x] Compile, recursively decode/re-encode, and fully simulate the exact Universal Router transaction.
- [x] Build the transaction state machine, local evidence journal, and receipt reconciliation.
- [x] Pin and live-check runtime bytecode hashes for Router, PoolManager, V4Quoter, and StateView.
- [x] Run automated tests, production build, Cloudflare dry-run, Vercel dry-run, and adversarial decoder review.

## Remaining execution-validation gates

- [ ] Configure and reconcile two production-grade RPC providers plus an independent indexing path.
- [ ] Confirm wallet connection and chain switching with two EVM wallets.
- [ ] Run testnet vertical slice.
- [ ] Run a small mainnet transaction only after the previous gates pass and explicit user approval.
- [ ] Record latency, failure, stale-state, and reconnect metrics.

## Public beta gates

- [ ] Counsel-reviewed initial jurisdiction allowlist.
- [ ] Stock Tokens/RWAs excluded or policy-gated until reviewed.
- [ ] Two RPC providers and independent reconciliation path.
- [x] Security review of frontend, dependencies, allowlists, and transaction decoder for the constrained v4 route.
- [ ] Kill switch and incident runbook.
- [ ] Small cohort beta with no unattended automation.
