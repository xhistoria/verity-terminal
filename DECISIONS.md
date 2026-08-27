# Decisions

## 2026-08-27 — Standalone product

Build separately from Vaultra. The local Vaultra checkout was deleted; GitHub and Vercel remain untouched.

## 2026-08-27 — Non-custodial by default

External wallet signing is the default MVP boundary. The backend may quote, simulate, validate, and track; it must not receive or store raw keys or seed phrases.

## 2026-08-27 — One venue first

Do not build a generic router. Select one chain-specific venue after quote, settlement-target, spender, ABI, simulation, and small-transaction verification.

## 2026-08-27 — Research before broad build

The product is feasible, but router coverage, provider reliability, liquidity, legal scope, and wallet behavior remain release gates.

## 2026-08-27 — Explicit truth states

Soft confirmation, receipt success, L1 posting, finality, revert, replacement, reorg, stale quote, provider outage, and unknown status must remain distinct.

## 2026-08-27 — Hosted preview boundary

Use Vercel for the first hosted preview because the environment is authenticated there; retain Cloudflare Worker compatibility. Keep the rate-limited public RPC visibly labeled. Do not add paid/authenticated RPC credentials until a shared platform rate limiter is available.
