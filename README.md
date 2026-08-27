# Verity Terminal

A constrained, non-custodial execution terminal for Robinhood Chain.

## Current public-beta scope

- Discover Rabby, MetaMask, and other injected wallets through Wagmi Core plus EIP-6963/EIP-1193.
- Offer WalletConnect QR/mobile pairing when `REOWN_PROJECT_ID` is configured for the deployment.
- Add or switch to Robinhood Chain (`4663`).
- Read the connected ETH balance.
- Simulate a bounded ETH → USDG trade through one pinned Uniswap V3 pool.
- Show expected output, minimum output, gas, router, pool fee, and quote expiry.
- Sign and broadcast only from the user's wallet.
- Track the receipt; a transaction hash is never labelled success.
- Keep a bounded, browser-local execution journal with JSON export and shareable public receipt checks.
- Publish the security, wallet, lifecycle, contracts, API, and limitation documentation at `/docs.html`.

The server does **not** receive private keys, sign transactions, or broadcast for users.

## Pinned execution path

- Router: `0xCaf681a66D020601342297493863E78C959E5cb2`
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- V3 pool (0.01%): `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`

Every address is versioned in source. Do not expand the allowlist without code/explorer verification and transaction tests.

## Local development

```bash
npm install
npm test
npm run build
npm run dev
```

## Deployment

The hosted beta uses Vercel; the same core remains deployable as a Cloudflare Worker.

```bash
npm run build
vercel deploy --dry --yes --project verity-terminal --prod
vercel deploy --yes --project verity-terminal --prod
```

Cloudflare compatibility check:

```bash
npx wrangler deploy --dry-run
```

Optional WalletConnect mobile/QR support requires a Reown Project ID. Configure it directly in the hosting environment and restrict its allowed origin to the canonical Verity domain. It is browser-visible configuration, not a wallet signing secret.

```bash
# Vercel: configure as a Production build environment variable.
vercel env add REOWN_PROJECT_ID production

# Cloudflare: configure REOWN_PROJECT_ID in Workers Builds / CI,
# then build before deployment. A runtime Wrangler secret will not
# modify an already compiled browser bundle.
npm run build
npx wrangler deploy
```

Optional authenticated RPC secrets are set interactively, never committed or sent through chat:

```bash
vercel env add RPC_URL production
vercel env add RPC_FALLBACK_URL production
# Cloudflare alternative:
npx wrangler secret put RPC_URL
npx wrangler secret put RPC_FALLBACK_URL
```

Without them, the application uses Robinhood's rate-limited public RPC and labels it explicitly. Provider failures disable quote preparation rather than fabricating data.

## Security boundary

- No seed/private-key import.
- No server-held signer.
- No arbitrary contract calls.
- Maximum input is 1 ETH per prepared quote.
- Slippage is bounded to 0.10–5.00%.
- Quote expiry is 60 seconds.
- Exact router, pair, fee tier, recipient, value, deadline, minimum output, and nested calldata are ABI-decoded again in the browser before wallet signing.
- Duplicate submission attempts are synchronously locked to one wallet prompt.
- Active transaction hashes persist locally and receipt reconciliation stays pinned to Robinhood Chain even if the wallet account/network changes.
- Quote API work is bounded to four concurrent requests per warm isolate and ten requests/minute/client, with `429` + `Retry-After`; broader launch still requires a shared platform WAF rule.

Simulation reflects a specific chain state and is not a guarantee. Users must review the wallet request and explorer receipt. The current hosted preview uses the rate-limited public RPC; authenticated paid RPC credentials should not be enabled until shared platform rate limiting is provisioned.

## Status and legal scope

This is independent software and is not affiliated with Robinhood or Uniswap. Stock Token/RWA execution, unattended copytrading, and global-jurisdiction claims are intentionally excluded from this beta pending separate technical and legal review.

See `RESEARCH.md`, `THESIS.md`, `DECISIONS.md`, and `NEXT.md` for the research and product boundaries.
