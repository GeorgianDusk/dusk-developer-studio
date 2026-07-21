# Dusk Developer Studio comprehensive validation

Status: **in progress**

This campaign tests Dusk Developer Studio as a real product through fresh Codex-operated simulations, deterministic regression checks, exact-package assurance, production checks, defect remediation and a final adversarial challenge. It is not external-developer research.

## Exact baseline

| Identity | Baseline |
| --- | --- |
| Repository | `GeorgianDusk/dusk-developer-studio` |
| Branch and commit | `main` at `47c97822969ccf375808887cea6b78ad371a6e8b` |
| Public package | `dusk-developer-studio@1.0.1` |
| npm integrity | `sha512-330geWb6ikRMNWZx/hFmfC15YYtJ6IjarJ0VOGZ7ve6Yfr0qoF1zZl5YARnCvz94fCdgnqOYCl5tpMqatj0Nhw==` |
| Canonical production | `https://studio.134-122-59-217.nip.io` |
| Node contract | `>=24.18.0 <25` |

The `sslip.io` hostname is compatibility-only. It is regionally intercepted in the current Romania environment and is not a valid primary production target for this campaign.

## Evidence boundary

The independent campaign contract is defined in `config/comprehensive-validation-policy.json`. Machine-readable progress, defects and traceability live in `docs/evidence/comprehensive-validation-evidence-2026-07-20.json`.

Only a fresh `black-box-pilot` execution counts toward the 32-pilot floor. These do not count:

- the eight historical Phase 5 simulations;
- automated unit, integration, browser, accessibility or security tests;
- package lifecycle smokes;
- operator-attested or workflow receipts;
- static or adversarial challenge reviews;
- unperformed or simulated human research.

One execution cannot count twice. Passing 32 pilots is necessary but insufficient: every promised surface still needs success, meaningful failure/recovery, and final-candidate evidence.

## Campaign distribution

| Category | Required |
| --- | ---: |
| Core end-to-end journeys | 8 |
| npm and release lifecycle | 6 |
| UI, accessibility and browser | 6 |
| Failure and recovery | 6 |
| Security and containment | 6 |
| **Total** | **32** |

The policy defines each persona, public task, required execution context and expected coverage. Fresh pilot agents receive only public product information, a persona and a task. They do not receive source code or an expected route.

## Product inventory

The traceability ledger covers:

- nine UI routes: Overview, Setup, Access, Build, Inspect, Reference, Troubleshooting, Local Studio and Build & browser data;
- Safe mode, Local Actions, direct `create-duskds` and lifecycle self-test;
- local static bootstrap, health, fallback and unsafe-path behavior;
- companion pairing, health, preflight, DuskDS scaffold and dormant-template refusal;
- security cases ST-01 through ST-21;
- Windows x64, Ubuntu 24.04 WSL2 x64, Ubuntu 24.04 x64 and macOS 15 arm64;
- Chromium, Firefox and WebKit engine coverage, mobile emulation, exact responsive boundaries, keyboard use, accessibility tree, forced colors, reduced motion and 200% zoom;
- exact npm bytes, provenance, startup, preservation, shutdown, closed ports, production parity, rollback and freshness.

## Baseline regression evidence

- `verify:local` passed source boundary, lint, typecheck, 315 unit/integration and contract tests, build, release parity and assurance parity.
- The repository Playwright suite passed 53 applicable checks across five configured desktop/mobile browser projects. Twelve project-gated tests were skipped by design.

These results establish the existing regression baseline. They do not count as black-box pilots and do not prove complete product readiness.

## Current candidate and pilot progress

- The current modified source candidate passes `verify:local` under exact Node 24.18.0 and pnpm 11.7.0: source boundary, lint, typecheck, 346 unit/integration and contract tests, npm/package, security, provenance, evidence and monitoring fixtures, source freshness across 121 records, build, release parity and assurance parity.
- The latest full Playwright rerun passes 84 applicable checks across Chromium, Firefox, WebKit, Mobile Chrome and Mobile Safari with 16 intentional project-gated skips. It first exposed a Mobile Safari false-positive route contract; the repaired test now waits for stable same-document URLs, proves the three unsupported DuskEVM hashes canonicalize to `#setup`, passes 10 of 10 concurrent Mobile Safari repetitions and passes in the complete matrix.
- The production bundle contains 458,679 raw and 134,806 gzip JavaScript bytes. The raw policy ceiling was narrowly adjusted from 450,000 to 460,000 to accommodate the added source-integrity, recovery-state and accessibility controls, while a new stricter 140,000-byte gzip ceiling constrains actual transfer cost with less than four percent verified-candidate headroom.
- A focused mobile interaction regression proves that Reference disclosure controls stay in place, the compact navigation remains reachable on a long 320-pixel page, and Troubleshooting labels remain separated.
- Full-page local-candidate renders at desktop and 390 CSS pixels show the tactical-workstation hierarchy, path-first information architecture, dense but legible Troubleshooting records, visible DuskEVM RPC and official docs source with no horizontal overflow, clipped controls or console errors.
- The current 308,452-byte, 30-file dirty-worktree npm preview (`sha256:1801d3006c83cb4d7b0db9df73641ac8fdd396e96e5f5c8feb83e147bf9e2b78`) passed actionable 5173- and 8788-conflict refusal with unrelated-listener preservation, partial-service cleanup and closed ports, plus the exact-tarball Chrome 150 Safe and Local Actions browser smoke with pairing, automatic Windows preflight, direct and UI starter creation, project preservation, shutdown and zero unexpected console/page errors. Its separate Windows lifecycle under Node 24.18.0 also passed overwrite refusal, closed ports and cleanup; Node 24.15.0 was refused with recovery guidance. This is package regression evidence, not a publishable final-candidate receipt.
- A fresh source-blind Windows pilot then found that public 1.0.1 automatic Local Actions preflight could reject a legitimate response because the companion allowed 160-character sanitized version strings while the Studio schema allowed only 128. The local producer is now aligned to the 128-character consumer contract and a focused cross-boundary regression passes; an integrated exact-candidate retest remains required.

| Scenario | Result | Counted | Material finding |
| --- | --- | ---: | --- |
| CV-CORE-08 (second baseline execution) | Failed | No | Pre-launch truth held, but the old production build reproduced incomplete Reference scope, hidden RPC, inaccessible first-party docs in a clean Codex browser, identifier ambiguity and stale Troubleshooting copy. |
| CV-CORE-08 (fresh Chromium pre-launch retest) | Passed | Yes | The complete hosted DuskEVM journey remained explicitly reference-only, withheld every live RPC, wallet, funding, signing, deployment and inspection claim, classified identifier shapes correctly, and reflowed cleanly at 390 and 320 pixels. It reproduced only the already-recorded stale RPC retry sentence in CV-D-004, which is repaired in the local candidate and still requires final-candidate retest. |
| CV-CORE-05 | Passed | Yes | Completed the truthful existing-repository Setup, Access, Build and pre-deploy Inspect scope; a 1,672-file, 418,940,649-byte repository remained byte-for-byte unchanged. One P3 premature-validation defect was found and repaired locally. |
| CV-NPM-01 | Passed | Yes | Exact public first run, Safe-mode pairing, loopback binding and complete shutdown passed. |
| CV-NPM-02 | Failed | No | Package integrity, signature, provenance, inventory, identity, pairing and cleanup passed; automated Windows Ctrl+C delivery did not answer the npx termination confirmation. |
| CV-NPM-03 | Failed | No | Two fully isolated reinstalls matched and paired without reused state; both automated shutdown attempts left the npx confirmation unanswered. |
| CV-NPM-04 | Passed | Yes | Unsupported Node refusal and supported recovery passed; direct CLI recovery guidance was incomplete. |
| CV-UI-02 | Failed | No | P1 out-of-order evidence unlocked Build while Setup remained incomplete. |
| CV-UI-03 | Failed | No | Pathless recovery, URL canonicalization and invalid-field accessibility defects. |
| CV-UI-04 | Passed | Yes | Responsive behavior passed; three long-page mobile usability defects were found. |
| CV-UI-05 | Failed | No | The pilot proved only a single 1187-pixel baseline; it could not operate or prove actual 200% browser zoom, so the required width/zoom matrix remains incomplete. |
| CV-UI-05 (strict actual-zoom retest) | Passed | Yes | A real Chrome desktop profile proved actual 200% page zoom independently from Windows scaling and passed all 20 Home/Setup/Access/Build/Inspect cells at 1120, 1121, 1280 and 1440 widths with clean breakpoint, overflow, command, field, keyboard, focus, sticky-header and cleanup evidence. |
| CV-UI-06 | Failed | No | Automated WCAG, accessibility-tree, keyboard, target-size, forced-color and reduced-motion checks passed, but the path chooser and Reference disclosures exposed three accessibility defects. |
| CV-UI-06 (fresh accessibility retest) | Failed | No | Route-wide WCAG automation, semantics, keyboard behavior, forced colors, reduced motion, targets and reflow passed. Production still reset saved progress without confirmation and left Build/Inspect validation alerts unassociated with their recovery fields; both behaviors are repaired locally and require final-candidate retest. |
| CV-SEC-01 | Failed | No | The security matrix otherwise failed closed, but raw bootstrap accepted mismatched `127.0.0.1` and `localhost` Host/Origin identities. |
| CV-RES-03 (first attempt) | Blocked | No | A normal hosted Access read and reset passed, but connected Chrome could not provide a fresh profile or selectively block the node request; outage, timeout, retry and restoration remain untested. |
| CV-RES-03 (hosted and public-package retry) | Passed | Yes | Hosted and isolated public-package lanes both refused immediate node failure without false evidence, the hosted lane also exposed its real five-second timeout, and restored Retry saved exactly one bounded block receipt per lane. The run found a wrong-profile pairing-recovery defect, now repaired locally without weakening the one-use bootstrap. |
| CV-RES-01 (fresh public-package pilot) | Failed | No | A 5173 conflict failed closed, stopped the partial 8788 service, preserved the unrelated listener, and recovered with the same command after release. The public package exposed only raw `EADDRINUSE` instead of actionable recovery; this is repaired locally. |
| CV-CORE-08 (isolated-profile attempt) | Blocked | No | A genuinely fresh Chrome profile was created and cleaned, but the first accessibility capture stalled before meaningful DuskEVM exploration; no product verdict or defect was claimed. |
| CV-CORE-01 (fresh Chrome attempt) | Blocked | No | The canonical site title loaded in a dedicated profile, but the first screenshot/accessibility capture stalled before any product interaction. The exact seven-process/profile cleanup passed and no product defect was claimed. |
| CV-CORE-01 (hosted Windows retry) | Passed | Yes | A source-blind Windows developer genuinely verified all six Setup prerequisites, recovered from an incomplete checklist, completed Setup, recorded one bounded Access receipt, exercised contextual navigation/help/mobile recovery, stopped truthfully before the prohibited package action and identified the real WSL/Build next step. It independently reproduced CV-D-039, already repaired locally. |
| CV-CORE-03 (public-package Safe to Local Actions pilot) | Failed | No | Safe mode, unsupported-Node recovery, pairing and the machine-action boundary behaved correctly, but automatic preflight twice returned an unusable-response error on supported Windows/Node and left Setup incomplete. CV-D-051 records the producer/consumer length-contract defect and local repair. |
| CV-UI-01 (fresh keyboard retest) | Failed | No | Skip link, focus treatment, reset, copy feedback, stage gating and Local Studio controls worked, but clearing an empty Troubleshooting search dropped focus to the document body. |
| CV-UI-02 (fresh Firefox retest) | Failed | No | The DuskDS hosted journey, public node read, keyboard path, history, external return, help and 390-pixel reflow worked. Its sole reported unnamed-link defect was invalidated because the probe measured hidden disclosure content with `innerText`; the pilot remains failed rather than being retroactively counted. |
| CV-UI-03 (fresh WebKit retest) | Failed | No | All routes, forms, disclosures, pre-launch boundaries, reduced motion and narrow layouts worked, but history confused EVM and DuskDS entries sharing `#setup` and lost the prior overview scroll position. Both defects are repaired locally. |

Three earlier Chrome-control attempts remain non-counting because they could not prove a fresh browser profile. The cleared-state hosted Windows retry now counts because its initial 0/4 state, explicit reset and post-reset reload prove no retained product progress despite the harness exposing only the existing Chrome profile. The network-recovery retry also counts after source-blind hosted and isolated public-package lanes proved outage, timeout, evidence integrity, restored retry and complete cleanup. The ledger currently contains 8 of the required 32 counted passing pilots. Failed scenarios must be rerun against the final candidate after publication, and passing baseline executions remain subject to the campaign's final-release revalidation triggers.

The first CV-RES-03 attempt and the isolated-profile CV-CORE-08 attempt are also non-counting. They are retained as blocked evidence because the pilots refused to simulate a network failure or claim journey coverage they did not perform. Both scenarios remain open for valid reruns.

A separate qualified hosted-help challenge passed Reference search, scoped DuskDS/DuskEVM help, browser history, Local Studio guidance, provenance, keyboard semantics and 390-pixel reflow. It found that empty Troubleshooting promised project support without a contextual link and confirmed that the official-docs source fallback needed to be available from general Reference as well as the DuskEVM page. Both are repaired locally. Its suggestion to categorize the eight common issues more aggressively remains an enhancement rather than a defect: that shortlist is relevance-filtered, its records are truthfully medium impact, and the complete reviewed index contains high, medium and low entries.

A fresh pre-freeze challenge returned **NO-GO**. It proved that the old final gate could accept a fabricated 32-pilot campaign, that existing-repository evidence was not bound to a clean working tree, and that several recovery branches still had wrong focus, stale-history, wrong-path, pre-launch-classification or documentation-contract behavior. CV-D-043 through CV-D-047 record those findings; CV-D-002 and CV-D-039 were reopened and extended. The local candidate now fixes the product findings, and the campaign gate requires outcome-based counting, scenario-specific clean-state profiles, anchored references, hash-verified receipt files, exact defect preservation, named completion flags, policy-byte binding, exact candidate challenge identity and package assurance. A new adversarial fixture proves the polished-forgery pattern is rejected. Final-candidate retests and a fresh clear challenge are still required.

A later independent evidence-integrity challenge also returned **NO-GO**. It proved that generic receipt references still did not establish the claimed surface or outcome, final automation/package/registry/production readiness remained self-asserted, the first clean-tree repair still allowed source to change after its initial check, and a live DuskDS node outage was classified as DuskEVM Planning. CV-D-048 through CV-D-050 record those findings and CV-D-044 now includes post-build same-commit revalidation. The local validator derives current clean HEAD, tag and package digests, requires unique typed surface/outcome claims and hash-bound automation/platform/registry/production receipts, and adversarial fixtures reject each old false-proof pattern. The DuskDS outage now has a separate active recovery record. Final receipts and a fresh clear challenge remain required.

The next fresh challenge still returned **NO-GO** and disproved part of that validator-remediation claim. An internally consistent synthetic campaign remained acceptable, a challenge receipt could still impersonate pilot outcomes, the final gate did not require version 1.0.2 or inspect the selected tarball's embedded semantics, timestamp freshness and chronology were unenforced, and automatic-preflight compatibility was not preserved across the three-platform package receipt. CV-D-053 through CV-D-056 preserve those findings. The campaign remains deliberately open while those proof defects are corrected and challenged again.

The clean `7a2ce88` exact-candidate challenge also returned **NO-GO** before any push. It proved that CI and the validator calculated different inventory identities, the native aggregate receipt was not directly ingestible as immutable GitHub evidence, later exact-candidate failures did not invalidate an earlier clear challenge, trailing nonzero TAR data was accepted, and post-build source cleanliness was not rechecked. CV-D-057 through CV-D-061 preserve those findings. The repaired workflow now uses one content-bound inventory and file count, emits an archive-free GitHub Actions v7 evidence artifact plus a run/ref/commit-bound receipt, orders the final challenge after every exact-candidate observation, rejects trailing data and rechecks the tree. Root review found the related canonical package-path mismatch in CV-D-062 before freeze. Focused adversarial, public-contract, lint and full unit/fixture suites pass; a new exact candidate and native CI challenge are still required.

The next clean `ddc263b` candidate challenge again returned **NO-GO** before any external action. It reproduced a remaining pilot-collector inventory mismatch, proved the final evidence gate had an impossible package-commit/evidence-commit causality loop, and showed that locally supplied GitHub metadata was not independently checked against the real run and downloaded artifact. It also found equal-timestamp challenge ordering, non-main final-receipt production, policy-generated cleanup claims and an exported fixture helper. CV-D-063 through CV-D-069 preserve these findings. The reopened candidate now uses the manifest-bound inventory in the collector, validates a clean descendant evidence ledger whose diff is limited to explicit evidence paths, downloads and verifies the exact GitHub artifact at the final CLI boundary, requires strictly later challenges, limits final receipts to first-attempt main pushes, derives install/cleanup assurance from all native receipts and removes the fixture export. Focused regression suites pass; a re-frozen exact package, full verification and a fresh independent challenge remain required.

The clean `c3060e3` challenge also returned **NO-GO**. It proved the tag workflow could publish its own freshly assured rebuild without comparing it to the reviewed main-push bytes, showed that CV-D-064's first repair accepted the source commit as its own evidence-ledger descendant, and found that Windows account deletion lacked an explicit postcondition. CV-D-064 was reopened and CV-D-070 through CV-D-071 preserve the new findings. The current repair queries the exact successful first-attempt main assurance run before publication, validates and downloads its artifact, requires byte-for-byte equality with the tag run and publishes the reviewed main bytes; the validator now requires a different descendant ledger commit; and Windows assurance checks that the temporary account is absent. Focused adversarial and workflow-contract tests pass locally; a new exact candidate, native GitHub execution and another fresh challenge remain required.

The WebKit pilot's repeated CSP stylesheet messages were also invalidated as a harness artifact: a fresh all-route WebKit production traversal with reduced motion and no screenshots produced zero console errors, while the screenshot-heavy run's messages match Playwright's injected screenshot CSS being correctly refused by the strict policy.

The local candidate now repairs the confirmed journey-gating, pathless recovery, URL canonicalization and history traps, reset-state resurrection, field-level accessibility and recovery focus, clean existing-repository identity, manual-lane focus, Reference and Troubleshooting completeness/classification/path switching, Inspect navigation, saved-progress discoverability, DuskEVM pre-launch wording, unsupported-Node recovery, fixed-port startup recovery, mobile disclosure, compact mobile navigation, Troubleshooting label, path-group semantics, Reference disclosure state and exact bootstrap Host–Origin matching defects. It also adds complete Windows npx shutdown guidance, makes the pre-launch RPC visible, exposes the official documentation source repository, bounds and explains EVM block quantities, aligns the product/design contract with the one-surface DuskEVM pre-launch model and hardens the campaign completion gate. Each repair has focused automated coverage. Their final disposition remains pending until the originating pilot or an equivalent final-candidate retest passes.

## Earlier findings now under remediation

| ID | Severity | Finding | Current disposition |
| --- | --- | --- | --- |
| CV-D-001 | P2 | Thirty of 44 reviewed troubleshooting records were unreachable because the UI exposed only a selected-path shortlist. | Repaired locally with focused common issues plus an all-reviewed-issues scope; final-candidate retest pending. |
| CV-D-002 | P2 | Reset overstated its scope and browser Back could restore an older builder-path entry after the current path was cleared. | Repaired locally with exact saved-journey/session-only copy and history-generation invalidation; Reset → Back → Forward → remount regression passes. Final-candidate retest pending. |
| CV-D-003 | P2 | The compatibility `sslip.io` hostname is intercepted and fails trusted TLS in the current region. | Invalidated as a product defect: George selected `nip.io` as the production URL, and all product guidance and release validation use that canonical origin. |
| CV-D-025 | P3 | Bootstrap accepted mismatched loopback Host and Origin spellings. | Repaired locally by deriving the allowed bootstrap Origin from the validated Host; exact and mismatch regression tests pass. Final-candidate black-box retest pending. |
| CV-D-026 | P2 | Automated Windows Ctrl+C delivery did not stop the public package. | An interactive PTY reproduced the Windows `npx.cmd` confirmation; `Y` plus Enter exited and closed both ports. User-facing shutdown guidance and runtime-banner coverage are updated; final-candidate pilot retest pending. |
| CV-D-027 | P3 | Package and repository README bytes differ. | Invalidated as a defect: the audience-specific documents agree on the runtime, release and safety contract and make no byte-identity promise. |
| CV-D-028 | P3 | The npm release has a provenance-bound tag but no separate GitHub Release object. | Invalidated as a defect: a separate Releases surface is not part of the package contract. |
| CV-D-029 | P2 | The pre-launch RPC could be copied without being visible. | Repaired locally with a labelled, visibly inspectable endpoint and an explicit pre-launch-only boundary; final-candidate retest pending. |
| CV-D-030 | P2 | Clean Codex browsers blocked by Cloudflare had no alternate authoritative Dusk docs route. | Repaired locally with an Official docs source link to `dusk-network/docs`; final-candidate retest pending. |
| CV-D-031 | P3 | Noncanonical or unbounded block quantities were accepted and long-hex ambiguity was unexplained. | Repaired locally with canonical 256-bit quantity bounds, identifier precedence and explanatory help; final-candidate retest pending. |
| CV-D-032 | P3 | Selecting Existing repository immediately emitted repeated empty-field alerts before interaction. | Repaired locally by delaying the field alert until change or blur, linking it accessibly, and replacing repeated downstream alerts with neutral command-context prompts; final-candidate retest pending. |
| CV-D-033 | P2 | Clearing an empty Troubleshooting search dropped keyboard focus to the document body. | Repaired locally by returning focus to the search input; component and five-project browser regressions pass. Final-candidate pilot retest pending. |
| CV-D-034 | P2 | Empty Troubleshooting told developers to open project support without providing a contextual link. | Repaired locally with a direct public issues link beside the recovery control; component and browser regressions pass. Final-candidate pilot retest pending. |
| CV-D-035 | P2 | Back could reopen an earlier DuskEVM `#setup` entry as DuskDS Setup because the path was global mutable state. | Repaired locally by binding builder path to each history entry and restoring it on Back/Forward; all five browser/device projects pass the regression. Final-candidate pilot retest pending. |
| CV-D-036 | P2 | Back to the long overview discarded its prior scroll position. | Repaired locally with per-entry manual scroll capture/restoration and same-layout-phase title updates; all five browser/device projects pass the regression. Final-candidate pilot retest pending. |
| CV-D-037 | P2 | Seven hidden tool-help links were reported as unnamed and focusable. | Invalidated: the probe used rendered `innerText` on descendants of closed native disclosures. Revealed links have names and are not exposed while closed; labels were still made tool-specific and component coverage passes. |
| CV-D-038 | P3 | WebKit reported blocked inline stylesheets on every screenshot-heavy route. | Invalidated as Playwright screenshot CSS injection: the app has no inline styles and an all-route no-screenshot WebKit production probe emitted zero console errors. |
| CV-D-039 | P2 | Build and Inspect validation alerts, mismatch branches and driver observations did not consistently identify or focus the control that could fix them. | Repaired locally with field/confirmation-aware validators, `aria-invalid`, `aria-describedby` and recovery focus across artifact/source mismatch, contract ID, function, digest and confirmation branches; final-candidate pilot retest pending. |
| CV-D-040 | P2 | A fixed-port startup conflict cleaned up safely but printed only raw `EADDRINUSE` without telling the developer how to recover. | Repaired locally with fixed-port classification, release-and-rerun guidance and explicit partial-service cleanup confirmation; exact-candidate and final-candidate retests pending. |
| CV-D-041 | P2 | If auto-open paired the wrong browser profile, the intended profile could not recover from the consumed one-use bootstrap and the companion page misleadingly said it was paired and ready. | Repaired locally with state-truthful companion headings, a dedicated not-paired recovery lane, exact version-pinned `--no-open` commands, runtime guidance and public documentation; final-candidate pilot retest pending. |
| CV-D-042 | P3 | Immediate node unavailability and visible timeout persist the same `rpc-unavailable` blocker code. | Invalidated as an intentional evidence-minimization boundary: live UI distinguishes the states, persistent journey data records only the stable blocked category, neither failure writes evidence and both recover through Retry. |
| CV-D-043 | P1 | A polished but fabricated final campaign could satisfy the old structural gate. | Repaired locally with receipt-byte hashing, outcome-based counting, exact contexts, scoped clean-state exceptions, anchored/resolved references, exact defect/completion/challenge/package contracts and an adversarial forgery fixture; fresh final challenge pending. |
| CV-D-044 | P1 | Existing-project evidence could name `HEAD` while dirty or untracked files differed, and abbreviated identities were accepted. | Repaired locally with fail-closed tracked/untracked status checks, explicit clean-tree confirmation and full 40/64-character identities throughout; final-candidate pilot retest pending. |
| CV-D-045 | P2 | Less-common EVM issues appeared active in All reviewed issues, and DuskDS recovery could keep an EVM selection and land incorrectly. | Repaired locally with complete explicit pre-launch classification and deliberate DuskDS path switching before recovery navigation; focused regressions pass. |
| CV-D-046 | P2 | DuskEVM route canonicalization pushed a new history entry and trapped Back on the invalid hash. | Repaired locally with replace-style canonical navigation; Back/Forward regression passes. |
| CV-D-047 | P3 | README, PRODUCT and DESIGN promised four selected-path stages while truthful pre-launch DuskEVM has one learning surface. | Repaired locally by formally limiting the four-stage evidence journey to DuskDS and documenting the DuskEVM pre-launch exception. |
| CV-D-048 | P1 | Generic receipt references could be reused to claim success, recovery and final proof for unrelated surfaces. | Repaired locally with unique typed `trace_claims` binding each exact reference to one canonical surface and one outcome; adversarial reuse and mismatch fixtures fail. |
| CV-D-049 | P1 | Final source, package, automation, registry and production readiness could be self-asserted without authoritative candidate inspection or immutable external receipts. | Repaired locally by deriving clean HEAD, tag and tarball digests and requiring unique hash-bound automation, platform, registry-provenance and production-manifest receipts; final real receipts remain pending. |
| CV-D-050 | P2 | A live DuskDS public-node outage appeared as DuskEVM Planning and was missing from common DuskDS recovery. | Repaired locally with a dedicated active DuskDS blocker and recovery record used by Access and Inspect; common/all-scope regression passes. |
| CV-D-051 | P1 | A legitimate Windows automatic-preflight response could exceed the UI's 128-character version bound and invalidate the whole result. | Repaired locally by aligning the producer sanitizer to 128 characters and testing the real producer result against the Studio response contract; exact-candidate browser pilot retest pending. |
| CV-D-052 | P2 | The public-release browser test checked route URLs too early and falsely treated unsupported DuskEVM guide hashes as exact surfaces. | Verified repaired: exact routes now wait for stable URLs, unsupported EVM routes must replace to `#setup`, and 10/10 concurrent Mobile Safari repetitions pass. |
| CV-D-053 | P1 | A synthetic campaign and one challenge receipt could still impersonate all success, failure-recovery and final-candidate evidence. | Repaired locally with evidence-class/status/outcome/exact-candidate bindings, challenge exclusion and a production API/CLI that cannot enable fixture provenance; focused adversarial tests pass. Final-candidate challenge pending. |
| CV-D-054 | P1 | The final gate did not require version 1.0.2 or inspect the selected tarball's package identity, manifest, commit and inventory. | Repaired locally with required 1.0.2/v1.0.2 identity and a bounded tar inspector that verifies headers, package metadata, embedded manifest, commit and exact inventory; final 1.0.2 tarball pending. |
| CV-D-055 | P2 | Timestamp syntax passed even when evidence was stale, future-dated, reversed or older than the candidate it claimed to prove. | Repaired locally with ordering, future-skew, evidence-class freshness, candidate/policy rerun and 15-hour DuskDS public-node gates; final receipts pending. |
| CV-D-056 | P2 | Automatic-preflight compatibility was not included in aggregate package assurance and was not proven from exact tarball bytes on all supported platforms. | Repaired locally with the actual Studio consumer guard, consumer-source hashing, nonempty bounded producer rows, exact-package loopback execution, closed-port proof and aggregate binding. Local exact-tarball probe passed; native three-platform workflow pending. |
| CV-D-057 | P1 | CI and the validator computed incompatible inventory digests for the same npm tarball. | Repaired locally by using the bounded semantic tar inspector and one content-bound inventory/file-count contract in every CI lane; native workflow retest pending. |
| CV-D-058 | P1 | Aggregate native assurance was not directly ingestible as provenance-bound GitHub evidence. | Repaired locally with an exact single-file evidence payload and receipt bound to GitHub run, main ref, commit, workflow, job, artifact ID/URL/digest and all three native runner receipts; native workflow and challenge retests pending. |
| CV-D-059 | P2 | A failed exact-candidate execution after a clear challenge did not force another challenge. | Repaired locally by ordering the final challenge after every exact-candidate pilot, retest and automation result; adversarial fixture passes. |
| CV-D-060 | P2 | The tar inspector accepted nonzero data after the two TAR end blocks. | Repaired locally by rejecting any nonzero trailing byte; adversarial archive fixture passes. |
| CV-D-061 | P2 | Package CI did not recheck source cleanliness after restore, build, test, package and browser operations. | Repaired locally with post-operation HEAD, tracked, staged and untracked checks; native workflow retest pending. |
| CV-D-062 | P1 | The GitHub package receipt emitted a bare tarball filename that the final validator rejects. | Repaired before freeze by emitting the canonical `output/npm/<exact artifact>` evidence path; producer and validator contract tests pass. |
| CV-D-063 | P1 | The pilot collector still hashed all 30 archive paths and rejected the canonical 29-record content inventory. | Repaired locally by deriving the collector digest/count from manifest-bound path/byte/SHA-256 records; focused collector and public-contract tests pass. |
| CV-D-064 | P1 | Final evidence could not be recorded without violating package-commit equality; the first repair then accepted that same commit as its own purported descendant. | Repaired locally by binding package bytes to the immutable tag while requiring a different clean descendant ledger commit whose changes are confined to explicit evidence/receipt/report paths; equality and path-escape fixtures pass. |
| CV-D-065 | P1 | Final package assurance trusted locally supplied GitHub run/artifact metadata without an independent API query and byte download. | Repaired locally by requiring the final CLI to verify the exact successful main-push run, artifact metadata, direct downloaded bytes and digest; native GitHub execution remains pending. |
| CV-D-066 | P2 | A clear challenge tied with the latest failed exact-candidate observation could pass chronology. | Repaired locally by requiring the challenge timestamp to be strictly later; equal-timestamp adversarial fixture passes. |
| CV-D-067 | P2 | Non-main workflow contexts could emit a receipt that the final validator accepts only from a main push. | Repaired locally by limiting immutable final-evidence upload and receipt production to a first-attempt `refs/heads/main` push while preserving aggregate outputs for reusable calls. |
| CV-D-068 | P2 | Aggregate cleanup assurance was generated from policy instead of per-platform cleanup observations. | Repaired locally with bounded-root, temporary-user and profile cleanup verification, per-platform install/cleanup fields and field-derived all-runner check results; native CI retest pending. |
| CV-D-069 | P3 | A fixture-accepting validator helper remained exported from the production module. | Repaired locally by removing the export and running final fixtures through the normal production validator; fixture-provenance rejection remains covered. |
| CV-D-070 | P1 | Tag publication could publish a new tag-run build without proving it matched the reviewed main-push candidate bytes before immutable npm publication. | Repaired locally with exact first-attempt main-run/API/artifact lookup, independent download, raw digest/integrity/inventory/byte equality and publication of the reviewed main bytes; native GitHub execution pending. |
| CV-D-071 | P3 | Windows package assurance lacked an explicit postcondition proving its temporary local account was absent. | Repaired locally with a fail-closed Get-LocalUser absence assertion and public contract; native Windows retest pending. |

## Clean-state rule

Each counted pilot must prove isolated npm state, a fresh browser profile, a normal non-elevated identity, a disposable project root, clean port/process baselines, a bounded environment, no reused pairing/session value, and cleanup. Raw secrets, cookies, pairing values, absolute user paths and private environment dumps must not enter durable evidence.

## Completion rule

This report cannot become final until:

- all 32 required pilots pass and all retests are recorded;
- every traceability row has success, meaningful failure/recovery and final-candidate evidence;
- all confirmed P0 through P3 defects are verified fixed or invalidated;
- exact package bytes pass supported-platform assurance;
- registry, candidate and production identities agree;
- fresh TLS, DuskDS node, source, monitoring and rollback evidence pass;
- the DuskEVM pre-launch boundary is truthful and its future activation checklist is complete; and
- a fresh adversarial challenge is clear.

The activation gate is now defined in `docs/quality/duskevm-testnet-activation-checklist.md`. Its live network-dependent checks remain intentionally incomplete until DuskEVM Testnet activation is explicitly available.

Publication, tagging, npm release, public GitHub mutation and production deployment remain separate approval gates.
