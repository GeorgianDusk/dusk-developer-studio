# AGENTS

## Mission

Maintain an independent open-source Dusk Developer Studio that helps developers choose between DuskEVM and DuskDS, understand the selected path, and complete supported local tasks safely.

The product has two surfaces:

- the static Hosted guide at `studio.134-122-59-217.nip.io`; and
- the functional local Studio started through the `dusk-developer-studio` npm package.

## Non-negotiables

- Do not publish, push, create a GitHub release, publish an npm version, or deploy unless the user explicitly authorizes that external action.
- Represent ownership accurately: this project is maintained through the `GeorgianDusk` account.
- Distribute the local Studio through the self-contained `dusk-developer-studio` npm package. Do not add a second distribution channel.
- Require Node.js `>=24.18.0 <25` for the local Studio.
- Keep the Hosted guide static. It must never call, proxy, start, or expose a service on a developer's machine.
- Bind the local Studio and companion only to IPv4 loopback. Never expose `packages/local-agent` from a VPS or public interface.
- Do not request, store, transmit, or log private keys, mnemonics, seed phrases, wallet passwords, seeders, profile entropy, API keys, credentials, or pairing material.
- Do not implement faucet dispensing, browser-based wallet signing, arbitrary command execution, or mainnet deployment automation.
- Keep Safe and Local Actions distinct. `npx dusk-developer-studio` starts Safe mode; `npx dusk-developer-studio local-actions` deliberately enables the allowlisted local checks and starter creation.
- Keep Dusk-specific facts data-driven with source labels, maturity flags, and freshness stamps.
- Do not claim Hedger implementation support, native deploy success, arbitrary native generation, live DuskEVM Testnet access, or production readiness without current evidence.
- Do not render remote Markdown or MDX.

## Source of truth

Start with `README.md`, `PRODUCT.md`, and `DESIGN.md`.

Use these documents for the relevant boundaries:

- `docs/security/threat-model.md`
- `docs/security/local-companion-boundary.md`
- `docs/security/deploy-automation-policy.md`
- `docs/deployment/self-hosting.md`
- `docs/deployment/companion-release.md`
- `docs/operations/companion-compatibility.md`

Official Dusk documentation remains the canonical protocol source.

## Change rules

- Preserve the static Hosted guide versus loopback local Studio separation.
- Keep the npm package free of additional install-time runtime dependencies and install lifecycle scripts.
- Treat package name, version, repository identity, file allowlist, commands, Node range, and provenance as one release contract.
- Preserve foreground-only operation, fixed loopback ports, in-memory pairing, exact frontend/runtime parity, Safe versus Local Actions separation, and project preservation.
- Keep external tool installation and wallet actions under the developer's control.
- Update user documentation and tests whenever a command, requirement, supported platform, security boundary, or recovery step changes.

## Verification

Run the checks appropriate to the change before handoff:

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

Changes to the npm package or local runtime also require:

- inspection of the packed file inventory;
- confirmation that no install lifecycle script or runtime dependency was introduced;
- clean Safe and Local Actions startup, pairing, shutdown, and project-preservation checks on each supported platform; and
- verification that the tested package bytes are the bytes selected for publication.

Real RPC, wallet, or deployment checks require explicit scope. Mocked checks are the default.
