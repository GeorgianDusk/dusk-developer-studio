# Developer simulation report — 2026-07-19

## Evidence status

This report records eight developer scenarios requested for Dusk Developer Studio. These are **agent-operated simulations, not sessions with external human developers and not human-user research**. An agent adopted each stated developer perspective, exercised the available product surface, and recorded observable behavior. Persona reactions and trust ratings are therefore heuristic signals, not statistically valid usability findings.

All eight original simulations are complete, but several produced partial or blocked results. A follow-up on 2026-07-20 installed Ubuntu `24.04.4 LTS` under WSL2 and executed the Linux portion of simulation 8. That follow-up closes the original no-distribution evidence gap for the working-branch manual lane; it does not convert the historical `1.0.0` results into release passes.

This report must not be cited as evidence that all eight simulations passed, that external developers validated the product, or that cross-platform release gates are complete. The exact packaged `1.0.1` candidate has not yet repeated these scenarios, so release-candidate status remains pending.

## Product and evidence boundary

- Hosted surface: `https://studio.134-122-59-217.nip.io`
- Published local package exercised in simulations 6 and 7: `dusk-developer-studio@1.0.0`
- Published source commit for those local-package runs: `5447a6eb008157e1e9bd6b38de1a3789d17a67b7`
- Local execution platform used in simulations 6 and 7: Windows, Node.js `24.18.0`, npm `11.16`
- Follow-up platform used for simulation 8: Ubuntu `24.04.4 LTS`, WSL2 kernel `6.6.87.2`, `x86_64`, under the non-sudo user `duskpilot`
- Follow-up scope: a working-branch, Studio-owned DuskDS starter derivative exercised with Rust and Cargo `1.94.0`; this was not the packaged `1.0.1` candidate
- Pending candidate: the exact self-contained `dusk-developer-studio@1.0.1` package must still repeat the relevant Safe-mode, Local Actions, and WSL/manual checks
- DuskEVM status during this review: pre-launch education only; no live Testnet RPC, wallet, deployment, or inspection claim was tested
- Wallet boundary: no funded wallet, private key, seed phrase, signing flow, transaction submission, or live deployment was used

The evidence has three distinct layers: the historical published `1.0.0` runs, working-branch remediation and follow-up evidence, and the pending exact `1.0.1` candidate rerun. Items described as **addressed in the working branch** were changed after the relevant observation. That label is not proof that the change has been merged, published to npm, or deployed. Items described as **pending verification** still require a clean retest against the exact release candidate.

## Coverage summary

| # | Scenario | What was actually exercised | Simulated perspective or environment | Result |
| --- | --- | --- | --- | --- |
| 1 | Hosted guide, novice Windows developer | Hosted navigation, DuskDS journey state, and controlled local-Studio boundary failure and recovery | First-time Dusk developer | Completed; useful but several labels and persisted states were confusing |
| 2 | Keyboard and narrow-viewport accessibility | Keyboard interaction and a `320 × 800` browser viewport, including empty search states | Developer relying on keyboard navigation and mobile-sized layout | Completed; one focus-recovery defect found |
| 3 | Security-conscious hosted user | Hosted/local boundary language, launch guidance, and trust cues | Developer evaluating whether local access is safe | Completed; security model was sound but under-explained |
| 4 | Experienced developer with an existing repository | Existing-project route, project-mode behavior, and Local Actions guidance | Developer protecting an established codebase | Completed; product behavior was conservative but the UI did not explain that clearly enough |
| 5 | DuskEVM pre-launch evaluator | DuskEVM chooser, setup classifier, support routes, and troubleshooting language | Solidity-oriented developer; macOS was a persona only | Completed; route structure obscured the useful classifier and overstated unavailable routes |
| 6 | Local Safe mode, Windows novice | The published npm package, loopback services, pairing, Access browser check, recovery, and shutdown | First-time local-Studio user | Partial: 10 of 11 checks passed; a CSP defect blocked the core Access check |
| 7 | Local Actions, Windows experienced developer | Real prerequisite checks, containment refusal, isolated starter creation, evidence/status behavior, preservation, and shutdown | Experienced DuskDS developer | Partial: containment was strong, but timeouts and path/status mismatches made the UI materially unreliable |
| 8 | Windows-to-WSL manual DuskDS lane | Historical hosted/Windows flow plus a real Ubuntu WSL2 follow-up: pinned Forge install and Studio-owned starter check, build, test, and verification | Experienced developer; real Windows and non-sudo Linux environments, still operated by an agent | Historical result partial; working-branch WSL derivative passed its commands, but the exact packaged `1.0.1` rerun remains pending |

## Simulation results

### 1. Hosted guide — novice Windows developer

**Objective.** Determine whether a developer unfamiliar with Dusk could choose DuskDS, understand the Hosted-versus-local boundary, and recover when a local action was unavailable.

**Observed behavior.** The product represented the constrained state honestly and the simulated developer remained at 1 of 4 journey steps when the required local evidence was unavailable. The controlled local-Studio failure and recovery path did not create a false success. Heuristic trust was `4/5`.

**Friction found.** A restored Access observation could contradict the current screen; a hosted public request was described as local; a stale Resume heading and the top-level “Automation” label were ambiguous; and the Inspect page was overly dense.

**Disposition.** Addressed in the working branch by restoring the saved block observation consistently, describing the safe check as a browser/public request, renaming the navigation destination to “Local Studio,” and reducing journey-context duplication on long step pages. Release-candidate verification remains required.

### 2. Keyboard and narrow-viewport accessibility

**Objective.** Check whether the core reference and troubleshooting interactions remain operable and understandable without a pointer and at a `320 × 800` viewport.

**Observed behavior.** Navigation and layout remained usable, but broadening an empty Hedger reference search moved the content without returning focus to the search field or announcing the changed result state. Long Build and Inspect pages also carried unnecessary context. Heuristic trust was `4/5`.

**Disposition.** Addressed in the working branch by returning focus to the search field, announcing the broader result set, adding a clear-search recovery control to troubleshooting, and withholding duplicated journey context from long step pages. Keyboard and narrow-viewport regression verification remains required.

### 3. Security-conscious hosted user

**Objective.** Assess whether a cautious developer can understand what runs locally, what the hosted site can reach, and why the npm launch path should be trusted.

**Observed behavior.** The fundamental static-hosted/loopback-local separation was intact, but the UI did not explain pairing, session lifetime, allowed browser origin, provenance, or managed project locations at the point of decision. The launch command was also not tied visibly enough to the current release. Heuristic trust was `3/5`.

**Disposition.** Addressed in the working branch with exact versioned launch guidance, an npm provenance link, pairing/session/origin explanations, project-location guidance, and corrected hosted-versus-local wording. The packaged and deployed result still needs exact-release verification.

### 4. Existing repository — experienced developer

**Objective.** Determine whether a developer can evaluate the Studio without risking an established repository or accidentally granting repository-wide access.

**Observed behavior.** The product did not import, crawl, attach to, or write into the existing repository. However, the relationship between the existing-project route and Local Actions was easy to misread, the UI did not state the non-access guarantee directly enough, journey status vocabulary was inconsistent, and project-mode selection reset unexpectedly. Heuristic trust was `4/5`.

**Disposition.** Addressed in the working branch with an explicit no-import/no-crawl/no-write explanation, distinct manual and Local Studio setup lanes, clearer journey labels, and session-only project-mode persistence. Paths are not persisted. Regression verification remains required.

### 5. DuskEVM pre-launch evaluator

**Objective.** Verify that a Solidity-oriented developer receives useful pre-launch education without being led to believe a live DuskEVM network path exists.

**Observed behavior.** The identifier classifier was useful but difficult to reach because the chooser led to an unordered reference view. Some troubleshooting text suggested routes or checks that do not exist before Testnet launch. macOS was only the simulated persona for this scenario; this was not macOS package validation. Heuristic trust was `3/5`.

**Disposition.** Addressed in the working branch by routing the chooser to the existing pre-launch overview at its Setup section, keeping support routes anchored to that overview, and removing misleading live-route language. A live DuskEVM Testnet journey remains intentionally out of scope until the network and its source-backed configuration are available.

### 6. Local Safe mode — Windows novice

**Objective.** Exercise the real published Safe-mode package as a first-time local user, including startup, pairing, the Access check, recovery, and shutdown.

**Actual run.** The exact `dusk-developer-studio@1.0.0` package associated with commit `5447a6eb008157e1e9bd6b38de1a3789d17a67b7` started on the expected loopback ports (`5173` and `8788`). Ten of eleven expected checks passed. The core Access browser request was blocked deterministically by the packaged static Content Security Policy because `https://testnet.nodes.dusk.network` was not allowed. Recovery success was `50%`, and heuristic trust was `3/5`.

**Safety result.** The process shut down cleanly and did not create a project.

**Disposition.** The exact Dusk Testnet origin was added to the local static CSP in the working branch, together with unit and packaged browser-smoke assertions. The fix is pending an exact release-candidate Safe-mode retest; the published `1.0.0` result remains failed for this check.

### 7. Local Actions — Windows experienced developer

**Objective.** Exercise actual allowlisted local capabilities, containment, prerequisite evidence, isolated DuskDS starter creation, failure recovery, preservation, and shutdown.

**Actual run.** The exact published `1.0.0` package and source commit were confirmed. The preflight completed all 17 required checks successfully; `wasm-opt` was reported as optional and unsupported. An attempt to use `C:\Windows` as a project location was refused without an outside write. A contained retry created an isolated starter atomically with nine expected items, Rust `1.94`, no links, no visible staging residue, and no outside-root writes. The project survived shutdown and the loopback services closed cleanly.

**Release-critical defects found.** The UI applied a generic five-second request timeout even though preflight took about 13 seconds and starter creation took about one minute. Both operations completed after the UI had already reported failure, so evidence and status could become dishonest. The runtime managed root (`%LOCALAPPDATA%\Dusk\DeveloperStudio\projects\duskds`) conflicted with UI examples and placeholders using `C:\tmp\dusk-studio-projects`. A containment refusal surfaced as a generic HTTP 500/not-connected state and still produced commands for the rejected path. Documentation advertised `DUSK_STUDIO_DUSKDS_PROJECT_ROOT`, but the published runtime did not consume it.

**Assessment.** Overall heuristic trust was `2/5`: containment `4/5`, truthful status `1/5`. The result is partial, not release-ready evidence for Local Actions.

**Disposition.** Remediation is in progress for capability-specific timeouts, a single reported managed root, allowlisted path handling, specific containment errors, suppression of commands for rejected or uncreated paths, evidence redaction, and the documented environment override. All items require a rerun against the exact release-candidate package before this scenario can pass.

### 8. WSL/manual DuskDS lane

**Objective.** Follow the manual DuskDS route as an experienced Windows developer intending to use WSL, validate real prerequisites, build isolated starter artifacts, read the hosted node, and confirm that unsupported execution does not receive a ready state.

**Historical `1.0.0` boundary — 2026-07-19.** The original scenario used Windows, Chrome, the hosted `1.0.0` experience, and real Git, Rust, Forge, and Deno checks. WSL2 was enabled but had zero installed distributions. The Linux commands and perspective in that original run were therefore simulated; the historical run remains partial and is not retroactively a Linux package pass.

**Historical `1.0.0` run.** Setup identified Git `2.55`, rustup `1.29`, Rust and Cargo `1.94`, the `wasm32` target and `rust-src`, and the expected Forge commit. The hosted node read reached block `3,838,710`. An isolated Forge starter was scaffolded and built, producing a `30,583`-byte contract and a `166,976`-byte driver. A relative Windows path failed, then recovered with an absolute `D:` path and correctly quoted `/mnt/d` translation. An extensionless `wasm-opt` shim supplied through `C:\nvm4w\nodejs` caused a build failure; removing that directory from the process `PATH` allowed recovery. A native-Windows VM test failed as expected, and readiness correctly refused to claim success. Temporary roots were removed after the run.

**Executed Ubuntu WSL2 follow-up — 2026-07-20.** Ubuntu `24.04.4 LTS` ran under WSL2 on kernel `6.6.87.2` (`x86_64`). The pilot used `/home/duskpilot/duskds-pilot-20260720/duskds-wsl-pilot-login` as its retained evidence project. The `duskpilot` account has no sudo access and a locked password.

Forge was installed with Cargo `1.94.0` from exact revision `d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a`. Installation exited `0` and emitted the exact warning `no Cargo.lock file published in dusk-forge-cli v0.1.0`. The installed binary reported version `0.1.0`, its Cargo receipt recorded the full expected commit and Rust `1.94.0`, and its SHA-256 was `3ba46f061146d1f1c068d9299401f82b2d1f4526754d146ec619f0c0ee19f5b3`.

**Toolchain finding and Studio-owned derivative rationale.** The upstream Forge `new` path hardcodes the moving `stable` toolchain and invokes `cargo +stable generate-lockfile`. During the follow-up it silently installed Rust `1.97.1`, despite the Studio contract naming Rust `1.94.0`. That transient toolchain was removed, and the final environment retained only Rust `1.94.0`, the `wasm32-unknown-unknown` target, and `rust-src`. Because an upstream moving alias cannot support a reproducible exact-version promise, the remediation direction is a Studio-owned reviewed starter derivative with an exact `1.94.0` contract and committed lockfile. This derivative was exercised in the follow-up; its repository integration and packaged-candidate verification are still in progress.

**Executed derivative evidence.** The lockfile was `68,200` bytes with SHA-256 `6657e6da48dc245860aa8575b0633d88e0cdd7fcedce524789c682d246284ea4`. The check phase exited `0`; the all-target build exited `0`; the test phase exited `0` with three integration tests passed and zero failed; and verification with the build skipped exited `0`, validating two WebAssembly artifacts and four exported functions.

The contract artifact was `19,612` bytes with SHA-256 `d300def4c3c6d9c919a95823051c00dcafba120cd2ab77a1db234ff57c88861b` and BLAKE3 `f12f7ecb062f91c62e0331dd3c77cf22e4de223529e6cd75e88cea2b02c5628c`. The driver artifact was `122,966` bytes with SHA-256 `58b40c74ebed4c01bf59ffa739d853ee13ad03ca908efa6deeae9d9706172b54`.

**Follow-up side effects.** Ubuntu WSL2 remains installed for repeatable validation. No prerequisite package was installed manually during the pilot, but the distribution's first boot did run Ubuntu's automatic unattended upgrades and changed base-system packages. No reboot, sudoers change, or system-wide developer-tool install was made; Rust, Cargo, and Forge were installed only under `duskpilot`'s home. The WSL virtual disk was approximately `13.97 GB`; `.cargo` used approximately `379 MB`, `.rustup` approximately `821 MB`, and retained pilot trees approximately `893 MB`. Two incomplete attempt trees were deliberately preserved alongside the successful project for diagnosis.

**Friction and remaining limitations.** The original `1.0.0` findings remain valid: Setup disclosed WSL too late, accepted an incompatible `wasm-opt` shim, did not explain the W3sper folder/file transition clearly enough, and lacked a WSL-specific reference. The follow-up additionally proved that Forge's moving `stable` bootstrap can violate the Studio's exact Rust contract and that Cargo could not apply `--locked` to the tested Forge `0.1.0` Git installation because the source revision did not provide a Cargo lockfile for that package. The successful Linux commands exercised a working-branch Studio-owned derivative, not the exact packaged `1.0.1` candidate, and no external human operated the flow.

**Assessment and disposition.** The historical heuristic trust rating remains `3/5`; it is not recalculated from an agent-only repair run. The real WSL follow-up establishes that the pinned manual derivative can check, build, test, and verify successfully inside Ubuntu WSL2 while retaining only Rust `1.94.0`. It does not establish that the release package passes. The Studio-owned starter, exact Forge executable resolution, incompatible-shim rejection, UI guidance, startup, pairing, preservation, shutdown, and port-closure behavior must be integrated and repeated against the exact packaged `1.0.1` candidate before a release pass is recorded.

## Findings that cut across scenarios

1. **The security architecture was stronger than its explanation.** Static hosting, loopback binding, deliberate Local Actions activation, containment, and project preservation behaved conservatively, but several screens did not give developers enough information to recognize those protections.
2. **Truthful status is a release property.** A backend operation completing after a frontend timeout is not merely inconvenient; it makes evidence, commands, and recovery guidance unreliable.
3. **One canonical project location is necessary.** Runtime enforcement, UI examples, follow-up commands, documentation, and environment overrides must agree on the same resolved root.
4. **Pre-launch DuskEVM content must remain educational.** Useful comparison and identifier guidance can ship now, but live RPC, wallet, deployment, and inspection states cannot be implied before current evidence exists.
5. **Accessibility recovery needs explicit focus management.** Changing an empty result set is insufficient when keyboard users are not returned to the control and notified of the new state.
6. **Tool presence is not tool compatibility.** Preflight needs to validate the executable behavior and agreed version contract, not merely accept a same-named shim found on `PATH`.
7. **Platform labels must match executed evidence.** The historical run had no Linux distribution; the follow-up now provides real Ubuntu WSL2 evidence, but only for the working-branch manual derivative and not yet for the packaged candidate.
8. **A moving toolchain alias is not a release contract.** Forge's `stable` bootstrap installed Rust `1.97.1` during a Rust `1.94.0` pilot. A Studio-owned, pinned starter is necessary if the product promises one exact supported toolchain.

## Release-candidate exit criteria from this simulation set

The eight scenarios and the real-WSL follow-up have been executed. They do not establish release readiness. A release pass can be recorded only when all of the following are true:

- the working-branch fixes are tested against one exact release-candidate package rather than only source files;
- Safe mode confirms the Access request under the packaged CSP;
- Local Actions waits for bounded backend completion and presents truthful evidence and status;
- the canonical managed root is identical across runtime, UI, generated commands, and documentation;
- rejected locations produce a specific containment response and no unusable follow-up commands;
- preflight rejects incompatible `wasm-opt` shims and the documented Rust/Forge toolchain contract is internally consistent;
- the exact packaged candidate reproduces the completed Ubuntu WSL2 setup, build, test, verification, and readiness checks with the Studio-owned pinned starter;
- startup, pairing, project preservation, shutdown, and port closure are rechecked; and
- any claim of external-human validation remains withheld until actual independent developers participate.

## Residual validation gap

Agent-operated simulations are useful for systematic flow coverage and reproducible fault discovery, but they cannot establish discoverability, comprehension, or confidence for the broader developer population. If the project later claims usability validation, that requires separately recruited external participants, a declared protocol, consent and privacy handling, and findings reported independently from this simulation record.
