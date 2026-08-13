# DuskEVM Testnet activation checklist

Status: **implementation candidate ready; exact-candidate pilots, funded Testnet proof, publication, deployment, and production evidence pending**

This checklist is the gate for changing Dusk Developer Studio from DuskEVM pre-launch education to a live developer journey. A published endpoint, copied network value, successful local probe, or announcement alone is insufficient. Every required gate must be evidenced against the exact release candidate before live controls or claims are enabled.

## 1. Authority and network identity

- [x] An authoritative Dusk source explicitly states that the Testnet is available for developer use.
- [x] The reviewed source identifies the canonical RPC origin, chain ID in decimal and hexadecimal, network name, native currency metadata, explorer, funding route, and support route; no faucet is claimed.
- [x] Two independent clean clients (Windows PowerShell and Ubuntu 24.04 WSL Python/urllib) observe the same chain ID, exact genesis and current block progression from the canonical RPC.
- [x] TLS, DNS, certificate chain, redirect policy, CORS behavior, response content type, client payload bounds and a bounded five-request availability sample are recorded.
- [x] Any candidate values already shown by Studio are rechecked at activation time rather than promoted from pre-launch metadata.
- [x] Source freshness is updated with the exact review timestamp, reviewer, URLs and expiry window.

## 2. Product boundary and data model

- [x] A release-gated feature state changes DuskEVM from `prelaunch` to `active`; no URL or dormant component can bypass it.
- [x] Setup, Access, Build and Inspect become distinct truthful steps with explicit success, failure and recovery states.
- [x] The active network record is schema-validated and allowlisted; arbitrary user-supplied RPC proxying remains unavailable.
- [x] Hosted RPC calls remain read-only, bounded by timeout and response size, and cannot carry wallet credentials or private endpoints.
- [x] Pre-launch labels, disabled-state copy and troubleshooting entries are replaced only where a corresponding live capability exists.
- [x] Reference and Troubleshooting continue to distinguish official, experimental, incomplete and ecosystem material.

## 3. Wallet, permissions and funding

- [ ] The supported wallet and minimum version are identified from current public sources.
- [x] Connection, account disclosure, network addition/switching, signing and transaction submission are separate user-mediated permissions.
- [x] Studio never asks for, accepts, stores or logs a seed phrase, private key, wallet password, raw signing request or funded-account secret.
- [x] Wrong-chain, rejected connection, locked wallet, missing wallet, stale session and unsupported-wallet recovery are tested with unfunded mocks.
- [x] Funding guidance names the authoritative bridge route and failure recovery without promising availability; no faucet is claimed.
- [x] No automated test uses a valuable or personally funded account; activation evidence uses unfunded fixtures until an approved disposable Testnet account is provided.

## 4. Build and deployment

- [x] The reviewed Foundry and Hardhat starters, dependency locks, compiler and toolchain versions are pinned.
- [x] Exact supported operating systems, architectures, Node/runtime versions and package-manager versions are declared.
- [ ] Starter creation, compilation, test, artifact inspection and deployment commands are verified from a clean project on every supported platform.
- [ ] Build output is bound to source identity, compiler settings, bytecode and artifact digests.
- [x] Deployment requires an explicit signer-owned action outside any hosted server proxy.
- [ ] Rejection, insufficient funds, nonce conflict, fee estimation failure, revert, timeout, interruption and retry do not create false completion evidence.
- [ ] A transaction is not treated as deployed until the reviewed receipt, chain identity, contract address and required finality are verified.

## 5. Access and Inspect evidence

- [x] Setup and Access separately verify a current block and wallet chain without implying wallet or deployment success.
- [x] Identifier classification remains local and does not claim existence, ownership, safety or canonicality.
- [x] Inspect distinguishes pending, included, reverted, RPC-finalized and unknown transactions, and explicitly states that replaced, dropped and not-yet-propagated cannot be distinguished from a hash alone.
- [ ] Contract inspection binds chain ID, contract address, deployment transaction, source/build identity and observed bytecode.
- [x] Explorer links are derived only from the reviewed allowlisted explorer origin and validated identifiers.
- [x] Reload, back/forward navigation, reset, mounted-session expiry and delayed-result expiry preserve truthful step status.

## 6. Security and privacy

- [x] Threat model and security matrix cover hostile RPC responses, oversized payloads, malformed JSON and byte data, slow responses, redirects, wrong chain, malicious identifiers, origin abuse, stale wallet sessions and in-flight expiry.
- [x] CSP and outbound allowlists include only the exact reviewed live origins required by enabled behavior.
- [x] Diagnostics redact wallet accounts where appropriate and exclude secrets, cookies, raw RPC bodies, private endpoints and transaction payloads.
- [x] Browser storage contains only bounded release, journey and public evidence metadata.
- [x] No hosted Dusk service receives Local Studio pairing material, local paths, tool output or project contents.
- [ ] Dependency, lockfile, provenance, advisory and artifact-integrity gates pass for the exact candidate.

## 7. User experience and accessibility

- [x] A first-time developer can distinguish hosted guidance, local automation and wallet-mediated actions before granting a permission.
- [x] Every step names prerequisites, what Studio will do, what remains manual, expected evidence and recovery.
- [x] Empty, loading, timeout, offline, rejected, wrong-chain and partial-finality states are directional and do not unlock later steps.
- [x] Keyboard, focus, live announcements, accessible names/states, forced colors, reduced motion, 200% zoom and documented viewports pass locally.
- [ ] Chrome, Firefox and WebKit engine runs pass; any real-Safari claim requires actual supported Apple evidence.
- [x] Copy controls, external-document return, deep links, canonical hashes, reset and saved-progress recovery pass locally.

## 8. Exact-candidate verification

- [ ] Unit, integration, security, package, build, release-parity and full cross-browser E2E suites pass.
- [ ] Fresh clean-state pilots cover the complete DuskEVM success journey plus every material failure and recovery branch.
- [ ] Pilot evidence is bound to exact source commit, npm integrity, operating system, runtime, browser and timestamps.
- [x] No confirmed P0 through P3 implementation defect remains unverified or unapproved.
- [x] Fresh independent product and security challenge reviews attempted to disprove the live claims and found no unresolved blocker.

## 9. Deployment, monitoring and rollback

- [ ] Source commit, package bytes, registry provenance, release tag and deployed assets all match.
- [ ] Production TLS, headers, CSP, routes, RPC behavior and read-only health checks pass after deployment.
- [x] Monitoring policy distinguishes Studio availability, RPC degradation, chain halt, wrong-chain response and expected user rejection.
- [x] Alert ownership, safe diagnostics and incident communication are defined without Better Stack or another unapproved dependency.
- [x] The immediately previous pre-launch commit `810c394c7a64f0e4b843d914646b7a73f5b42780` is retained as the rollback source target.
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

Until that receipt is complete, this branch remains an unpublished release candidate. The deployed v1.0.19 surface remains the pre-launch baseline and cannot claim the candidate's live wallet, funding, RPC, build, deployment or inspection evidence.
