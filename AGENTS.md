# AGENTS

## Mission

Maintain an independent open-source Dusk Developer Studio that helps developers choose between DuskEVM and DuskDS and follow the selected path safely. The architecture is a static public Studio plus an optional loopback-only local companion.

## Non-negotiables

- Do not publish, push, create a release, or deploy to a live domain unless the user explicitly authorizes that external action.
- Never imply this repository is an official Dusk Network or Dusk Foundation product.
- Never expose `packages/local-agent` from a VPS or bind it to anything other than loopback.
- Do not request, store, transmit, or log private keys, mnemonics, seeders, profile entropy, API keys, wallet passwords, or wallet secrets.
- Do not implement faucet dispensing, browser-based signing, arbitrary command execution, or mainnet deployment automation.
- Keep Dusk-specific facts data-driven with source labels, maturity flags, and source freshness stamps.
- Do not claim Hedger implementation support, native deploy success, arbitrary native generation, wallet automation, or production status without current evidence.
- Do not render remote Markdown or MDX.
- Keep binary publication disabled until platform identity, clean-machine, security review, support, rollback, and explicit maintainer approval gates pass.

## Source of truth

Start with `README.md`, `PRODUCT.md`, and `DESIGN.md`. Use `docs/security/threat-model.md`, `docs/security/local-companion-boundary.md`, `docs/deployment/self-hosting.md`, and `docs/deployment/companion-release.md` for implementation and release boundaries.

## Verification

Before handoff, run as much of this as the change requires:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm check:no-secrets
pnpm check:freshness
pnpm check:boundary
```

Changes to the companion, signing policy, or release workflow require the complete local verification gate and the relevant static release-workflow tests. Real RPC or wallet checks require explicit scope; mocked checks are the default.
