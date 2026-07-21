# Self-host the Hosted guide

The Hosted guide is a static web application. It provides path selection, educational journeys, public read-only checks, resources, and troubleshooting. It must not proxy, start, or connect to a local companion.

Developers who need machine-specific checks or starter creation run the local Studio separately:

```bash
npx dusk-developer-studio@1.0.6
npx dusk-developer-studio@1.0.6 local-actions
```

## Build

Requirements:

- Node.js `>=24.18.0 <25`
- pnpm `11.7.0`

```bash
corepack enable
corepack install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm check:no-secrets
pnpm verify:local
pnpm e2e:public
```

The deployable static artifact is `apps/studio/dist`.

Deploy from a clean reviewed commit and preserve `release-manifest.json` and `assurance-receipt.json` with the exact artifact.

## Caddy example

`deploy/caddy/studio.caddy` is the configuration used by the GeorgianDusk deployment at `studio.134-122-59-217.nip.io`.

For another environment, replace the hostname and document root. Preserve:

- the Content Security Policy;
- `/healthz`;
- SPA fallback;
- no-cache HTML and receipt behavior;
- immutable hashed assets;
- private log handling; and
- the prohibition on public ports 5173 and 8788.

The fragment deliberately contains no `reverse_proxy`, loopback address, authentication handler, or companion port.

## Deployment boundary

- Label the deployment with its actual maintainer and source repository.
- Link to official Dusk documentation for canonical protocol instructions.
- Keep DuskEVM labelled as pre-launch until its real Testnet is verified.
- Keep mainnet reference-only unless a separately reviewed product change says otherwise.
- Do not copy `.env` files, local receipts, diagnostics, package caches, test artifacts, or credentials into the web root.
- Verify TLS, redirects, security headers, cache behavior, key routes, source links, controlled RPC degradation, and closed public ports.
- Link the deployed artifact to its exact source commit.

See [public deployment monitoring](../operations/public-monitoring.md) for the checks used by the GeorgianDusk deployment.
