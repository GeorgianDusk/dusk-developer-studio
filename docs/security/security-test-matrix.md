# Studio Security Test Matrix

Date: 2026-07-18
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
| ST-12 Dusk Forge/process failure | nonzero exit, timeout, process-output overflow, staged-tree resource overflow, ordinary descendant survival, and Forge-stage cleanup | Output/time/filesystem growth stay bounded, the tracked direct process or ordinary process group is terminated, and no target/stage remains. Deliberately detached same-user daemons remain outside this portable guarantee. |
| ST-13 Diagnostics | synthetic absolute paths/raw failures plus minimal health/scaffold responses and bounded Forge receipt assertions | Responses contain allowlisted fields only; local paths and raw output are removed, while Forge identity is limited to package, version, repository, and full revision. |
| ST-14 Capability allowlist | strict request schema, portable project-name validation, exact Dusk Forge command/argument assertion, and Cargo install-receipt revision mismatch fixtures | Added command fields, shell metacharacter names, modified tool shapes, or unreviewed Forge revisions do not execute. |
| ST-15 Source freshness | versioned receipt validator plus expired/future/unreachable/missing-coverage/content-drift fixtures | Build fails closed when provenance is stale, future-dated, unverified, incomplete, or no longer matches covered data bytes. |
| ST-16 Release scope | canonical tracked-source classifier plus provider/generated/sensitive fixtures | Product gates remain scoped; provider/generated material is rejected from Git and metadata-counted only as quarantine. |
| ST-17 Portable distribution | payload/runtime verifier, deterministic archive fixtures, release signing fixtures, extracted target smoke, release-parity UI tests, and child-environment regression | Wrong target, tampering, undeclared files, mixed releases, unsafe paths, secrets, untrusted signatures, inherited credentials, and non-runnable archives fail closed. |
| ST-18 Exact signed candidate lifecycle | adversarial ZIP directory/local-header fixtures, strict dual-launcher index and package manifest, required macOS staple-ticket files, one-time bootstrap/session probes, safe/action mode parity, Studio-owned listener inspection before and after preflight, minimal child environment, isolated user-data roots, fixed-port closure, and identity-revalidated install cleanup | Traversal, collisions, bombs, bad CRCs/modes, extra entries, symlink/reparse boundaries, inherited credentials, mode substitution, missing staple tickets, unexpected Studio listeners, hardcoded install-cleanup claims, or cleanup outside the runner-owned ephemeral root fail closed. It does not claim machine-wide process containment. |
| ST-19 Staged publication decision | run-bound target records, retained lifecycle evidence, signing/transport/candidate/publication fixtures, exact-key schemas, raw-evidence digest binding, strict timestamps, maximum age, and monitoring-revisit bounds | Candidate evidence can be accepted while publication is disabled, but schema 2 rejects every transport and publication dossier because gate artifacts and actor identities are not authenticated; stale, future, caller-digested, self-reviewed, incomplete, or mixed-run evidence also fails closed. |
| ST-20 Unsigned engineering assurance | native Windows x64, Linux x64, and macOS arm64 hosted runners; elevated/root rejection before extraction; one-use S4U limited-token Windows lifecycle under a temporary standard user; exact-SID task, process, profile, LSA account-right, and account teardown; two-build receipt and launcher-digest comparison; unsigned exact-inventory ZIP creation/extraction; both mode lifecycles; platform observations; point-in-time verified absence of every exact workflow-owned candidate path; no retained workflow artifacts | Engineering regressions, privileged-launch acceptance, substituted launchers, non-reproducible builds, unsafe packages, lifecycle failures, unconfirmed tracked shutdown, Windows task/profile/account-right/account cleanup failure, any Windows publisher signature, executable Linux stacks or special modes, macOS ad-hoc-integrity failures, unexpected Gatekeeper acceptance, retained workflow-owned candidate paths, attempted workflow-artifact transfer, or publication-trust claims fail closed. On unconfirmed shutdown, lifecycle-owned roots are preserved for ephemeral-runner disposal rather than recursively deleted. A pass remains same-runner, unsigned, unauthenticated diagnostic evidence only; the elevation guard is not hostile-admin/root containment, and pull-request code can modify the lane and its validators. |

## Platform behavior

The reparse test creates a Windows directory junction on Windows and a directory
symlink on POSIX. Tracked process-group shutdown uses `taskkill /T /F` on
Windows and a detached process group on POSIX; it does not claim containment of
a deliberately detached same-user tool daemon. The unsigned lane rejects the
hosted runner's elevated Windows token, then uses a temporary standard local
user through a one-use, limited S4U scheduled task for lifecycle checks. The
assurance harness verifies the exact temporary SID, removes any task-owned
processes and profile, deletes the task, removes the SID's LSA account-right
record, and deletes the account before it can pass; this task is CI scaffolding,
not companion product behavior. Linux and macOS use `sudo` only to prove
privileged launch rejection before running lifecycles normally. The required
`.github/workflows/studio-linux-security.yml` lane asserts
`process.platform === "linux"`, runs the POSIX filesystem/process tests
explicitly on Ubuntu 24.04, then runs the complete source/product gate. The
production helper stays bound to IPv4 loopback; IPv6 origins/authorities are
rejected rather than partially supported.

## Failure handling

The private staging directory is removed only after its parent real path and directory identity are revalidated. If parent identity becomes untrusted, cleanup refuses to follow that path; an operator may quarantine the stage after restoring the approved root. This favors containment over aggressive cleanup.

No security test invokes a funded wallet, signing flow, live RPC mutation, public companion, or real Dusk Forge generation. Process and filesystem effects use isolated temporary roots and fixed local child-process fixtures.
