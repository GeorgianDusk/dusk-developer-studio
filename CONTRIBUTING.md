# Contributing

Contributions that improve developer safety, source accuracy, accessibility, cross-platform behavior, package quality, or the DuskEVM and DuskDS journeys are welcome.

## Development setup

Requirements:

- Node.js `>=24.18.0 <25`
- pnpm `11.7.0`

```bash
corepack enable
corepack install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm dev
```

## Before opening a pull request

1. Open or reference an issue for material behavior, architecture, security-boundary, package, or UX changes.
2. Keep Dusk-specific claims in the data layer and attach a current canonical source, review date, and maturity label.
3. Preserve the static Hosted guide versus loopback local Studio boundary.
4. Preserve Safe versus Local Actions separation.
5. Add or update tests for every changed behavior.
6. Run the verification appropriate to the change.
7. Explain risk, verification, user impact, rollout, and rollback implications in the pull request.

```bash
pnpm check:no-secrets
pnpm verify:local
pnpm e2e
```

## npm package changes

The user package is `dusk-developer-studio`.

Package changes must preserve:

- Node.js `>=24.18.0 <25`;
- no additional install-time runtime dependencies;
- no install lifecycle scripts;
- `npx dusk-developer-studio` for Safe mode;
- `npx dusk-developer-studio local-actions` for Local Actions;
- a strict package file allowlist;
- Apache-2.0 `LICENSE` and `NOTICE`;
- exact repository, issue, and homepage metadata; and
- foreground-only loopback operation.

Inspect the packed file inventory and run clean package startup, pairing, shutdown, and project-preservation checks on every supported platform. Publication must use the exact package bytes that passed those checks.

## Security and privacy

Do not include wallet secrets, credentials, private incident details, internal Dusk material, pairing values, user paths, or unredacted diagnostics.

Security findings belong in the private reporting path described in [SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution is licensed under Apache-2.0 and that you have the right to submit it.
