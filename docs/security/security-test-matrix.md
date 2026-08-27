# Studio security test matrix

The matrix defines the durable security behaviors expected from the Hosted guide, npm package, local runtime, and companion.

| Case | Permanent coverage | Expected result |
| --- | --- | --- |
| ST-01 Authentication | Unauthenticated health and capability requests; malformed scaffold body | Session rejection occurs before body parsing or capability work. |
| ST-02 Session lifecycle | Wrong pairing value, second-pair rotation, old-session replay, and expiry | Wrong, expired, revoked, and replayed sessions have no capability. |
| ST-03 Origin | Missing, `null`, malicious, hosted, and allowlisted local origins | Only an exact allowlisted local Studio origin receives CORS or a session. |
| ST-04 Host | Malicious, missing-port, IPv6, and expected IPv4 or localhost authorities | Only the exact configured loopback authority and port pass. |
| ST-05 Private Network Access | Unpaired and paired OPTIONS cases | Preflight is validated; Private Network Access is denied unless separately reviewed and enabled. |
| ST-06 Request body | Content type, declared or chunked oversize, invalid JSON or schema, and slow-body cases | Requests fail with bounded responses before allocation or work. |
| ST-07 Rate and concurrency | Pairing limit, per-session capability limit, and overlapping requests | Deterministic rejection bounds attempts and allows only the documented active capability count. |
| ST-08 Lexical path | Traversal, outside absolute, drive-relative, UNC, device, trailing-dot, and Unicode names | Only cross-platform-safe names and paths contained by an approved root pass. |
| ST-09 Link and reparse containment | Parent junction or symlink, staged link, and target-swap fixtures | Link and reparse components are rejected; parent and target are revalidated before promotion. |
| ST-10 Existing or concurrent target | Empty, non-empty, and two-request same-target cases | Existing content is never merged; concurrent calls produce one atomic winner. |
| ST-11 Partial project creation | Population failures injected at multiple stages | No final target is visible and a trusted temporary stage is removed. |
| ST-12 Tool and process failure | Nonzero exit, timeout, output overflow, filesystem growth, descendant survival, and cleanup | Effects remain bounded, tracked processes stop, and no final target appears. A deliberately detached same-user process remains outside this guarantee. |
| ST-13 Diagnostics | Synthetic paths, raw failures, minimal responses, and bounded tool identity | Responses contain allowlisted fields only; user paths and raw output are removed. |
| ST-14 Capability allowlist | Strict request schema, project-name validation, exact command and argument assertions, tool-identity mismatch, planted operating-system helpers, relative search entries, canonical directory aliases, and project-scoped executable shims | Added fields, shell text, modified tool shapes, planted helpers, poisoned or aliased search paths, and unreviewed tool identities do not execute. |
| ST-15 Source freshness | Expired, future, unreachable, missing-coverage, and content-drift fixtures | Product checks fail closed when Dusk provenance is stale, unverified, incomplete, or changed. |
| ST-16 Source scope | Tracked-source classifier with generated, provider, secret, and cache fixtures | Provider, generated, local-state, credential, and secret material is excluded from release scope. |
| ST-17 npm package contract | Package metadata, Node range, dependency and lifecycle-script absence, strict file inventory, license, repository, integrity, and provenance | Unexpected package identity, contents, dependencies, scripts, or provenance fail the package gate. |
| ST-18 Mode and lifecycle | Clean Safe and Local Actions runs, startup, pairing, identity parity, tool denial or enablement, project preservation, shutdown, and port closure | Safe cannot escalate; Local Actions exposes only reviewed capabilities; both modes close cleanly without deleting projects. |
| ST-19 Cross-platform behavior | Windows x64, Linux x64, and macOS arm64 package execution under a normal user | The same package contract and security behavior holds on every supported platform. |
| ST-20 Published-byte identity | Pack once, inspect, test the exact package archive, and publish that same digest | The package selected for publication is byte-for-byte the package that passed the checks. |
| ST-21 Embedded Rust dependency health | Policy-bound Cargo lock hash and versions, weekly Cargo-aware Dependabot updates, a pinned RustSec scan, exact owner/expiry-bound informational-warning review, and exact short-lived vulnerability review with reachability and mitigation evidence | New, removed, or changed vulnerabilities; unreviewed vulnerabilities; new or changed warnings; expired or incomplete reviews; ignored advisories; and dependency or lock drift fail CI. |
| ST-22 JavaScript dependency health | Frozen pnpm lockfile, exact transitive security overrides, and a live moderate-or-higher npm advisory gate | A vulnerable resolved version, missing reviewed override, lock drift, or live moderate-or-higher advisory fails CI. |
| ST-23 DuskEVM identity and degradation | Chain ID, genesis, progression, wrong or frozen network, timeout, redirect, CORS, HTTP, malformed, wrong-ID, subject-mismatch, non-canonical, odd-length bytecode, uint256 overflow, and oversized RPC responses | Only the exact reviewed progressing Testnet identity and response subject record evidence; every other state is explicit and retryable without wallet access. |
| ST-24 Wallet action separation | Missing or locked wallet, discovery, rejected connection, unknown-chain add, switch decline, chain/account events, malformed or oversized account lists, zero and positive balance, reload, expiry during a delayed wallet decision, and signing-method call inventory | Each action invokes only its named EIP-1193 method set; an expired in-flight result is discarded; no account or balance is persisted; no signing or submission method is called. |
| ST-25 EVM starters and receipts | Foundry and Hardhat transactional scaffolds, missing files, unsafe receipt paths, package inventory, fresh compile/test, dependency audit, toolchain switch, and delayed scaffold response | Both reviewed starters are atomically created and structurally verified; completion is bound to the initiating toolchain and request generation; malformed, incomplete, or stale receipts fail closed and no secret or local path is returned. |
| ST-26 Transaction-state semantics | Missing transaction, pending, included, reverted, RPC-finalized tag, unknown status, replacement ambiguity, mismatched subject, malformed receipt, and explorer link | Studio never infers finality, DuskDS settlement, or success; each bounded read names the exact state and limitation. |
| ST-27 Activation expiry and rollback | Source expiry, network expiry, changed genesis/configuration, old browser evidence, mounted-session expiry, expiry during delayed RPC or wallet work, and inert-boundary restoration | Live controls and in-flight results fail closed, completion no longer presents as current, and reactivation requires a complete evidence rerun. |

## Platform behavior

Windows path tests use directory junctions and reparse points. POSIX tests use symbolic links and mismatched user or group identities. Linux also tests active process capabilities.

Tracked shutdown uses the platform's bounded process-tree or process-group mechanism. It does not claim containment of a deliberately detached tool running under the same user.

The local Studio rejects administrator or root execution before listeners, filesystem work, or developer-tool invocation. This protects against accidental privileged use; it is not a defense against an administrator who can alter the program or its environment.

The companion binds to IPv4 loopback. IPv6 origins and authorities are rejected rather than partially supported.

## Failure handling

Temporary project data is removed only after the approved parent real path and directory identity are revalidated. If that identity becomes untrusted, cleanup refuses to follow the path. This favors containment over aggressive deletion.

Package checks reject unexpected files, links, paths, metadata, dependencies, install lifecycle scripts, and repository identity before the local runtime starts.

Security tests use isolated temporary roots and unfunded fixtures. They do not invoke a funded wallet, sign a transaction, submit a deployment, or mutate a live RPC endpoint. Live DuskEVM checks are limited to bounded public reads; wallet and transaction failure fixtures use disposable mocks with no secret material.
