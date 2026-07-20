# Changelog

Notable Dusk Developer Studio changes are recorded here.

## Unreleased

## 1.0.1 - 2026-07-20

### Added

- Add a reviewed, packaged DuskDS counter starter with an exact Rust `1.94.0` toolchain, Cargo lockfile, MPL-2.0 license text, and upstream provenance.
- Add `dusk-developer-studio create-duskds <project-name>` for creating one new starter beneath the current working directory.
- Add exact-package checks for direct and Local Actions scaffolding, overwrite refusal, clean shutdown, and post-shutdown project preservation.

### Changed

- Replace moving Forge starter generation with the Studio-owned reviewed template while retaining exact Forge checks for build, test, and verification.
- Clarify Hosted, Safe mode, Local Actions, existing-project, recovery, WSL, and native macOS support boundaries throughout the developer journey.
- Publish subsequent immutable npm versions through GitHub OIDC trusted publishing while preserving the initial `1.0.0` bootstrap record.

### Security

- Bind completed-action recovery to the exact starter file inventory and content digest.
- Tighten project-name, filesystem-root, containment, runtime-platform, timeout, and evidence-identity validation.
- Verify the packaged DuskDS template inventory, lockfile, provenance, and installed-tarball behavior before publication.
- Bind historical npm bootstrap controls to the preserved `1.0.0` publication receipt and require explicit exact-tarball scaffold, preservation, and shutdown proofs.

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
