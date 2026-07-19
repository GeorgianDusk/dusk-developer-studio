# Changelog

Notable Dusk Developer Studio changes are recorded here.

## Unreleased

## 1.0.0 - 2026-07-19

### Added

- Add the self-contained `dusk-developer-studio` npm package with no additional install-time runtime dependencies.
- Add `npx dusk-developer-studio` for Safe mode and `npx dusk-developer-studio local-actions` for allowlisted local checks and starter creation.
- Add a revision-bound DuskDS manual Testnet deployment gate inside Inspect, with explicit Rusk Wallet guidance, placeholder-only commands, and no wallet access.
- Add post-deploy contract metadata and data-driver inspection for a matching recorded build.

### Changed

- Present the public site as the Hosted guide and direct machine-specific tasks to the loopback local Studio.
- Separate submission from inclusion and finality.
- Require contract metadata to report `driver_available: true` before enabling driver reads.
- Fail readiness closed on blocked, skipped, future-dated, expired, or identity-mismatched evidence.
- Refresh DuskDS guide, Rusk Wallet, HTTP API, Forge, resources, and troubleshooting references.
- Treat DuskEVM as an educational pre-launch journey until its Testnet can be verified.

### Security

- Keep Safe and Local Actions as distinct startup choices.
- Bind both local services to IPv4 loopback, keep pairing material in memory, and require exact frontend/runtime parity.
- Remove secret-shaped values from child tool environments.
- Terminate tracked child processes during timeout, overflow, and shutdown.
- Preserve the documented same-user boundary for external developer tools, including the limitation around deliberately detached processes.
- Reject privileged local Studio launches before listeners, filesystem changes, or developer-tool execution.
