# Self-hosting the static Studio

The hosted Studio is a static, read-only web application. It must not proxy, start, or expose the local companion.

## Build

```bash
corepack enable
corepack install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm check:no-secrets
pnpm verify:local
pnpm e2e:public
```

The deployable static artifact is `apps/studio/dist`. Deploy only from a clean reviewed commit and preserve `release-manifest.json` plus `assurance-receipt.json` with the exact artifact.

## Caddy example

`deploy/caddy/studio.caddy` is the configuration used by the current GeorgianDusk production deployment at `studio.134-122-59-217.sslip.io`. Replace its hostname and document root for another environment. Keep the content-security policy, cache boundaries, `/healthz`, and SPA fallback unless a reviewed change requires otherwise.

The fragment deliberately contains no `reverse_proxy`, loopback address, authentication handler, or companion port. CI validates that boundary and parses the configuration with the pinned Caddy version.

## Deployment boundary

- Label every deployment with its actual maintainer and source repository.
- Link to official Dusk documentation for canonical protocol instructions.
- Keep mainnet reference-only unless a separately reviewed product decision changes that status.
- Do not copy development `.env` files, local receipts, diagnostics, test artifacts, or signing material into the web root.
- Verify TLS, headers, cache behavior, key routes, source links, RPC degradation behavior, and that ports 5173 and 8788 are not publicly reachable.

A self-hosted copy should link back to its exact source commit and maintainer.

The GeorgianDusk production deployment's scheduled checks, assigned issue-alert channel,
rehearsal input, and response expectations are documented in
[public deployment monitoring](../operations/public-monitoring.md).
