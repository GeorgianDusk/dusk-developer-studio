# DuskEVM Testnet activation checklist

Status: **blocked on an explicit DuskEVM Testnet activation decision and live verification**

This checklist is the gate for changing Dusk Developer Studio from DuskEVM pre-launch education to a live developer journey. A published endpoint, copied network value, successful local probe, or announcement alone is insufficient. Every required gate must be evidenced against the exact release candidate before live controls or claims are enabled.

## 1. Authority and network identity

- [ ] An authoritative Dusk source explicitly states that the Testnet is available for developer use.
- [ ] The reviewed source identifies the canonical RPC origin, chain ID in decimal and hexadecimal, network name, native currency metadata, explorer, faucet or funding route, and support/status route.
- [ ] Two independent clean clients observe the same chain ID and current block progression from the canonical RPC.
- [ ] TLS, DNS, certificate chain, redirects, CORS behavior, response content type, payload bounds and rate-limit behavior are recorded.
- [ ] Any candidate values already shown by Studio are rechecked at activation time rather than promoted from pre-launch metadata.
- [ ] Source freshness is updated with the exact review timestamp, reviewer, URLs and expiry window.

## 2. Product boundary and data model

- [ ] A release-gated feature state changes DuskEVM from `prelaunch` to `active`; no URL or dormant component can bypass it.
- [ ] Setup, Access, Build and Inspect become distinct truthful steps with explicit success, failure and recovery states.
- [ ] The active network record is schema-validated and allowlisted; arbitrary user-supplied RPC proxying remains unavailable.
- [ ] Hosted RPC calls remain read-only, bounded by timeout and response size, and cannot carry wallet credentials or private endpoints.
- [ ] Pre-launch labels, disabled-state copy and troubleshooting entries are replaced only where a corresponding live capability exists.
- [ ] Reference and Troubleshooting continue to distinguish official, experimental, incomplete and ecosystem material.

## 3. Wallet, permissions and funding

- [ ] The supported wallet and minimum version are identified from current public sources.
- [ ] Connection, account disclosure, network addition/switching, signing and transaction submission are separate user-mediated permissions.
- [ ] Studio never asks for, accepts, stores or logs a seed phrase, private key, wallet password, raw signing request or funded-account secret.
- [ ] Wrong-chain, rejected connection, locked wallet, missing wallet, stale session and unsupported-wallet recovery are tested.
- [ ] Faucet or funding guidance names the authoritative route, expected limits and failure recovery without promising availability.
- [ ] No test uses a valuable or personally funded account; activation evidence uses disposable unfunded or explicitly approved Testnet fixtures.

## 4. Build and deployment

- [ ] The reviewed starter, dependency lock, compiler, Foundry or equivalent toolchain and source commit are pinned.
- [ ] Exact supported operating systems, architectures, Node/runtime versions and package-manager versions are declared.
- [ ] Starter creation, compilation, test, artifact inspection and deployment commands are verified from a clean project on every supported platform.
- [ ] Build output is bound to source identity, compiler settings, bytecode and artifact digests.
- [ ] Deployment requires an explicit wallet action outside any hosted server proxy.
- [ ] Rejection, insufficient funds, nonce conflict, fee estimation failure, revert, timeout, interruption and retry do not create false completion evidence.
- [ ] A transaction is not treated as deployed until the reviewed receipt, chain identity, contract address and required finality are verified.

## 5. Access and Inspect evidence

- [ ] Access verifies chain ID and a current block without implying wallet or deployment success.
- [ ] Identifier classification remains local and does not claim existence, ownership, safety or canonicality.
- [ ] Inspect can distinguish pending, included, reverted, replaced, finalized and unknown transactions.
- [ ] Contract inspection binds chain ID, contract address, deployment transaction, source/build identity and observed bytecode.
- [ ] Explorer links are derived only from the reviewed allowlisted explorer origin and validated identifiers.
- [ ] Reload, back/forward navigation, reset and stale-evidence expiry preserve truthful step status.

## 6. Security and privacy

- [ ] Threat model and security matrix cover hostile RPC responses, oversized payloads, malformed JSON, slow responses, wrong chain, malicious identifiers, origin abuse and stale wallet sessions.
- [ ] CSP and outbound allowlists include only the exact reviewed live origins required by enabled behavior.
- [ ] Diagnostics redact wallet accounts where appropriate and exclude secrets, cookies, raw RPC bodies, private endpoints and transaction payloads.
- [ ] Browser storage contains only bounded release, journey and public evidence metadata.
- [ ] No hosted Dusk service receives Local Studio pairing material, local paths, tool output or project contents.
- [ ] Dependency, lockfile, provenance, advisory and artifact-integrity gates pass for the exact candidate.

## 7. User experience and accessibility

- [ ] A first-time developer can distinguish hosted guidance, local automation and wallet-mediated actions before granting a permission.
- [ ] Every step names prerequisites, what Studio will do, what remains manual, expected evidence and recovery.
- [ ] Empty, loading, timeout, offline, rejected, wrong-chain and partial-finality states are directional and do not unlock later steps.
- [ ] Keyboard, focus, live announcements, accessible names/states, forced colors, reduced motion, 200% zoom and documented viewports pass.
- [ ] Chrome, Firefox and WebKit engine runs pass; any real-Safari claim requires actual supported Apple evidence.
- [ ] Copy controls, external-document return, deep links, canonical hashes, reset and saved-progress recovery pass.

## 8. Exact-candidate verification

- [ ] Unit, integration, security, package, build, release-parity and full cross-browser E2E suites pass.
- [ ] Fresh clean-state pilots cover the complete DuskEVM success journey plus every material failure and recovery branch.
- [ ] Pilot evidence is bound to exact source commit, npm integrity, operating system, runtime, browser and timestamps.
- [ ] No confirmed P0 through P3 defect remains unverified or unapproved.
- [ ] A fresh challenge review attempts to disprove the live claims and finds no unresolved blocker.

## 9. Deployment, monitoring and rollback

- [ ] Source commit, package bytes, registry provenance, release tag and deployed assets all match.
- [ ] Production TLS, headers, CSP, routes, RPC behavior and read-only health checks pass after deployment.
- [ ] Monitoring distinguishes Studio availability, RPC degradation, chain halt, wrong-chain response and expected user rejection.
- [ ] Alert ownership, safe diagnostics and incident communication are defined without Better Stack or another unapproved dependency.
- [ ] The immediately previous pre-launch build and configuration are retained as a tested rollback target.
- [ ] Rollback restores the inert pre-launch boundary and removes every live DuskEVM control if identity, safety or availability becomes uncertain.

## Activation receipt

The final activation receipt must record:

- exact Studio commit, version, package integrity and production asset digests;
- authoritative source URLs and their review timestamps;
- verified network, RPC, explorer, wallet, toolchain and starter identities;
- platform/browser matrix results and clean-state pilot IDs;
- security, monitoring and rollback evidence;
- all defect dispositions; and
- the explicit activation approval and deployment timestamp.

Until that receipt is complete, DuskEVM remains an educational pre-launch surface and cannot claim live wallet, funding, RPC, build, deployment or inspection evidence.
