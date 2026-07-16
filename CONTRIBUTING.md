# Contributing

Contributions that improve developer safety, source accuracy, accessibility, cross-platform behavior, or the DuskEVM/DuskDS journeys are welcome.

## Before opening a pull request

1. Open or reference an issue for material behavior, architecture, security-boundary, or UX changes.
2. Keep Dusk-specific claims in the data layer and attach a current canonical source with a review date and maturity label.
3. Preserve the hosted/static and local/loopback boundary.
4. Add or update tests for every changed behavior.
5. Run `pnpm check:no-secrets` and `pnpm verify:local`; run `pnpm e2e` for UI or journey changes.
6. Explain risk, verification, rollout, and rollback implications in the pull request.

Do not include wallet secrets, credentials, private incident details, internal Dusk material, or unredacted diagnostics. Security findings belong in the private reporting path described in `SECURITY.md`.

By contributing, you agree that your contribution is licensed under Apache-2.0 and that you have the right to submit it.
