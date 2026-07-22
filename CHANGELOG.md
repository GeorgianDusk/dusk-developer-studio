# Changelog

Notable Dusk Developer Studio changes are recorded here.

## Unreleased

## 1.0.13 - 2026-07-23

### Fixed

- Preserve the validated `localhost` spelling when the local Studio proxies pairing and session checks to the companion, so the documented exact `localhost` Host/Origin pair works without weakening mismatched-origin rejection.
- Replace raw operating-system failures from direct `create-duskds` starter creation with bounded recovery guidance that contains no local path or staging detail.

### Verification

- Exercise an exact `localhost` bootstrap and authenticated session-status round trip against a companion that rejects every Host/Origin mismatch, alongside the existing loopback security suite.
- Assert that direct starter-creation diagnostics remove raw error codes, absolute paths, and internal staging names while preserving actionable retry guidance.

## 1.0.12 - 2026-07-22

### Fixed

- Open the exact read-only-repository recovery from the existing-project Build lane, focus it, and label the destination as selected guidance instead of reporting that no blocker was recorded.
- Let Safe mode start when an unused Local Actions project root is invalid or exceeds the Windows Forge path budget; the stricter root validation now applies only when machine actions are enabled.
- Document the reserved `.dusk-studio-staging` transaction directory and its bounded stale-stage recovery after an uncatchable process termination instead of promising that starter creation leaves no coordination sibling.

### Verification

- Exercise the Safe-mode fix in Windows package assurance with a deliberately over-budget default project path and an invalid Local Actions override before running the normal Local Actions lifecycle.

## 1.0.11 - 2026-07-22

### Fixed

- Keep legacy guide links neutral until the developer chooses DuskEVM or DuskDS, then preserve the selected path in navigation, browser history, Reference, and Troubleshooting links.
- Require a clean, writable Git checkout before existing-repository setup and provide direct recovery guidance when the checkout is read-only or has uncommitted work.
- Prevent DuskDS Forge starter failures on Windows by rejecting managed-root and project paths that exceed the tested linker-safe budgets before any files are created.
- Refresh Local Studio pairing state after companion restarts without an expected unauthenticated health request appearing as a browser-console error.
- Classify absent Dusk Forge receipts and executables as missing prerequisites while reserving version-mismatch results for installed but incompatible tools.
- Display the normalized DuskEVM identifier produced by the helper instead of leaving developers to infer the converted value.

### Security

- Extend exact-package assurance to prove detached-process containment on Linux, Windows, and macOS and bind that result into every platform receipt.

## 1.0.10 - 2026-07-22

### Fixed

- Recover safely from interrupted starter creation by removing verified orphan staging state while preserving active, ambiguous, oversized, and reparse-containing directories.
- Keep keyboard focus on the search field after clearing a dynamic Reference or Troubleshooting empty state.
- Associate each invalid Build path or project-name field with its own persistent inline error.
- Show a visible retry state when browser clipboard access fails, and ignore stale copy completions.

## 1.0.9 - 2026-07-22

### Fixed

- Clarify in safe diagnostics that a `ready` browser-journey step is not proof that a network or service is live, and mark DuskEVM explicitly as pre-launch and not Studio-activated.

## 1.0.8 - 2026-07-22

### Fixed

- Keep keyboard focus on the Access and Inspect hosted-check controls while their asynchronous node reads are running and after the result appears.

## 1.0.7 - 2026-07-22

### Fixed

- Restore keyboard focus to the Reset browser progress trigger after activating Cancel, including real Chromium, Firefox, and WebKit behavior.

## 1.0.6 - 2026-07-22

### Security

- Require the companion request Host and browser Origin to use the same approved loopback hostname spelling, while preserving exact `127.0.0.1` and exact `localhost` operation.

## 1.0.5 - 2026-07-21

### Fixed

- Recognize the Local Studio's user-facing occupied-port recovery message in the native Linux pilot harness, while still requiring a failed, unsignalled launch before recovery can pass.
- Replace the broken DuskEVM deep-dive link, label linked live-action guides as pre-launch planning, and warn against raw-private-key command arguments.
- Make the Local Studio page explicit that machine checks and starter creation are DuskDS-only while DuskEVM remains reference-only.
- Clear an invisible contextual troubleshooting filter when users request the complete reviewed index.
- Explain that the local identifier helper accepts unsigned decimal block numbers and normalizes them to hexadecimal.
- Use the PowerShell-safe npm.cmd shim in Windows prerequisite commands and add direct Node/npm recovery guidance without weakening script policy.
- Keep the independent DuskDS latest-block observation available before Build while continuing to gate source, deployment-readiness, and data-driver evidence.

## 1.0.4 - 2026-07-21

### Fixed

- Create the publication-receipt directory before writing the post-publication OIDC receipt, so a successful npm publication finishes with complete release evidence.
- Restore keyboard focus to a visible control after Back or Forward restores a deep scroll position.
- Let Escape cancel the browser-progress reset confirmation without changing saved data.
- Restore the required Access tool confirmation alongside saved manual node evidence, keeping completed re-entry internally consistent.
- Preserve the unchanged compressed-JavaScript and total-transfer limits while narrowly raising the raw JavaScript ceiling for the new focus and evidence safeguards.
- Keep the browser tab title synchronized when a Local Studio session changes from connecting or unpaired to ready.

## 1.0.3 - 2026-07-21

### Changed

- Make exact-package browser assurance classify Chrome's late preflight abort telemetry only after exact Request/Response identity, origin, CORS, authoritative schema, rendered UI, ordering, and terminal-state checks pass.
- Keep every unrelated browser transport failure fatal and record the preflight terminal outcome in the bounded assurance receipt.

## 1.0.2 - 2026-07-21

### Added

- Add comprehensive clean-state campaign evidence, exact surface/outcome traceability, immutable candidate receipts, and a DuskEVM Testnet activation checklist.
- Add automatic-preflight coverage to the exact-tarball browser smoke and explicit browser/history/accessibility recovery regressions.

### Changed

- Make the DuskDS Setup, Access, Build, deployment-readiness, and Inspect journey more explicit, field-specific, and recoverable across hosted and Local Actions modes.
- Preserve route-specific builder path and scroll state, canonicalize unavailable DuskEVM steps to its single pre-launch surface, and make every reviewed troubleshooting entry reachable with correct path classification.
- Require post-build same-commit clean-tree revalidation before existing-repository evidence can be recorded.
- Improve fixed-port, wrong-profile pairing, unsupported-Node, mobile navigation, and official-documentation recovery guidance.

### Security

- Align automatic-preflight producer output with the Studio's bounded response schema.
- Bind final campaign claims to unique typed receipt evidence and derive clean source, tag, tarball, registry, and production identity at the final gate.
- Preserve one-use pairing, exact Host/Origin matching, constrained local actions, closed-port cleanup, and project-preservation guarantees in exact-package tests.

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
- Refresh the reviewed DuskDS Cargo lock to remediate `GHSA-7gcf-g7xr-8hxj` and `GHSA-r6v5-fh4h-64xc`, and add recurring Cargo dependency monitoring.

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
