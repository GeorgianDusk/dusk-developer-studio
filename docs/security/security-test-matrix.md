# Studio Security Test Matrix

Date: 2026-07-10
Scope: static public Studio and optional loopback companion

The protected whole-system audit defined ST-01 through ST-16. These cases are now durable product checks rather than one-off audit probes.

| Case | Permanent coverage | Expected result |
|---|---|---|
| ST-01 Authentication | `serverSecurity.test.ts`: unauthenticated health and malformed scaffold body | Session rejection occurs before body parsing or capability work. |
| ST-02 Token/session lifecycle | wrong pairing value, second-pair rotation, old-session replay, and expiry tests | Wrong, expired, revoked, and replayed sessions have no capability. |
| ST-03 Origin | missing, `null`, malicious, hosted, and allowlisted local origins | Only an exact allowlisted local Studio origin receives CORS or a session. |
| ST-04 Host | malicious, missing-port, IPv6, and expected IPv4/localhost authorities | Only the exact configured loopback authority and listening port pass. |
| ST-05 PNA | unpaired/paired OPTIONS and Private Network Access cases | Preflight is validated; PNA is absent and denied unless separately enabled. |
| ST-06 Body | content-type, declared/chunked oversize, invalid JSON/schema, and slow-body cases | Requests fail with bounded 400/408/413/415 responses before allocation or work. |
| ST-07 Rate/concurrency | pairing limit, per-session capability limit, and overlapping preflight cases | Deterministic 429 responses bound attempts and allow only one active capability. |
| ST-08 Lexical path | traversal, outside absolute, drive-relative, UNC, reserved device, trailing-dot, and Unicode project-name cases | Only portable names and paths lexically contained by an approved root pass. |
| ST-09 Reparse containment | existing parent junction/symlink, staged reparse entry, and injected target swap | Reparse components are rejected and target absence is revalidated before promotion. |
| ST-10 Existing/concurrent target | empty, non-empty, and two-request same-target cases | Existing content is never merged; concurrent calls produce one atomic winner. |
| ST-11 Partial template copy | population failures injected after entries 1, 2, and 3 | No final target is visible and the trusted private stage is removed. |
| ST-12 Dusk Forge/process failure | nonzero exit, timeout, process-output overflow, staged-tree resource overflow, descendant survival, and Forge-stage cleanup | Output/time/filesystem growth stay bounded, the process tree is terminated, and no target/stage remains. |
| ST-13 Diagnostics | synthetic absolute paths/raw failures plus minimal health/scaffold responses and bounded Forge receipt assertions | Responses contain allowlisted fields only; local paths and raw output are removed, while Forge identity is limited to package, version, repository, and full revision. |
| ST-14 Capability allowlist | strict request schema, portable project-name validation, exact Dusk Forge command/argument assertion, and Cargo install-receipt revision mismatch fixtures | Added command fields, shell metacharacter names, modified tool shapes, or unreviewed Forge revisions do not execute. |
| ST-15 Source freshness | versioned receipt validator plus expired/future/unreachable/missing-coverage/content-drift fixtures | Build fails closed when provenance is stale, future-dated, unverified, incomplete, or no longer matches covered data bytes. |
| ST-16 Release scope | canonical tracked-source classifier plus provider/generated/sensitive fixtures | Product gates remain scoped; provider/generated material is rejected from Git and metadata-counted only as quarantine. |
| ST-17 Portable distribution | payload/runtime verifier, deterministic archive fixtures, release signing fixtures, extracted target smoke, release-parity UI tests, and child-environment regression | Wrong target, tampering, undeclared files, mixed releases, unsafe paths, secrets, untrusted signatures, inherited credentials, and non-runnable archives fail closed. |

## Platform behavior

The reparse test creates a Windows directory junction on Windows and a directory symlink on POSIX. Process-tree termination uses `taskkill /T /F` on Windows and a detached process group on POSIX. The required `.github/workflows/studio-linux-security.yml` lane asserts `process.platform === "linux"`, runs the POSIX filesystem/process tests explicitly on Ubuntu 24.04, then runs the complete source/product gate. The production helper stays bound to IPv4 loopback; IPv6 origins/authorities are rejected rather than partially supported.

## Failure handling

The private staging directory is removed only after its parent real path and directory identity are revalidated. If parent identity becomes untrusted, cleanup refuses to follow that path; an operator may quarantine the stage after restoring the approved root. This favors containment over aggressive cleanup.

No security test invokes a funded wallet, signing flow, live RPC mutation, public companion, or real Dusk Forge generation. Process and filesystem effects use isolated temporary roots and fixed local child-process fixtures.
