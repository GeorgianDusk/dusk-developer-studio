# Dusk Developer Studio

> Independent open-source project maintained by [GeorgianDusk](https://github.com/GeorgianDusk). Official Dusk documentation remains the canonical protocol source.

Dusk Developer Studio is a developer cockpit for choosing and following the right Dusk builder path: DuskEVM for Solidity/EVM tooling, or DuskDS for native Rust/WASM/DuskVM work.

The current production Studio is [studio.134-122-59-217.sslip.io](https://studio.134-122-59-217.sslip.io).

## Use it today

- Follow the active DuskDS Setup → Access → Build → Inspect guide with source-backed public-node, W3sper, Forge, and data-driver guidance.
- Browse the complete DuskEVM journey as a pre-launch educational preview. DuskEVM Testnet is not live yet, so live RPC, wallet, balance, and inspection evidence is unavailable and deferred.
- Use the hosted Studio as a static, docs-only guide; it never runs local machine actions or proxies the companion.
- Clone the repository and run the Studio locally with the commands below.

## What it provides

- A first-screen choice between an active DuskDS guide and a clearly labelled DuskEVM pre-launch preview, followed by one focused four-step journey.
- Source-labelled capability, network, resource, and troubleshooting references.
- DuskEVM architecture, safety boundaries, and Foundry guidance without claiming that its Testnet is already live.
- DuskDS prerequisites, public read-only node guidance, Dusk Forge guidance, and constrained starter creation.
- A loopback-only local companion for allowlisted preflight checks and starter scaffolding.
- Static self-hosting assets, security headers, source freshness receipts, and release assurance gates.

## Security model

The public site is static. Local machine actions run only through the optional companion on `127.0.0.1`, require a paired loopback browser session, and remain capability-gated and allowlisted. Public companion binaries are not distributed yet, so the hosted and source-checkout experiences remain docs-only for machine actions.

The Studio never asks for, stores, transmits, or logs private keys, mnemonics, wallet passwords, seeders, profile entropy, or API secrets. It does not dispense faucet funds, sign browser transactions, automate mainnet deployment, or execute arbitrary local commands.

See [SECURITY.md](SECURITY.md), [docs/security/threat-model.md](docs/security/threat-model.md), and [docs/security/local-companion-boundary.md](docs/security/local-companion-boundary.md).

## Local development

Requirements: Node.js 24.11.0 and pnpm 11.7.0.

```bash
corepack enable
corepack install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm dev
```

The Studio opens at `http://127.0.0.1:5173`.

Source-checkout development is docs-only for machine actions. The secure companion experience is exercised through the portable build and test pipeline, which keeps its pairing secret in supervisor memory. No manual token-copy workflow is supported. Never expose port 8788 or bind the companion to a public interface.

## Verification

```bash
pnpm check:no-secrets
pnpm verify:local
pnpm e2e
pnpm audit --prod --audit-level moderate
```

The main CI workflow repeats the product, security, browser, Linux, and Windows command gates from a clean checkout. The manual signed-RC workflow remains fail-closed and does not publish releases.

## Repository map

- `apps/studio` — React/Vite Studio UI.
- `packages/core` — validated Dusk data models and safe command generation.
- `packages/local-agent` — paired loopback companion.
- `packages/local-runtime` — portable runtime supervisor.
- `packages/templates` — constrained starter templates.
- `data/dusk` — source-labelled Dusk capability and network records.
- `docs/security` — threat model and security boundaries.
- `docs/deployment` — self-hosting and companion release policy.
- `.github/workflows` — pinned CI and protected signed-RC automation.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security reports must follow [SECURITY.md](SECURITY.md) and must not be posted publicly before coordinated review.

## License and names

Code and repository documentation are licensed under Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
