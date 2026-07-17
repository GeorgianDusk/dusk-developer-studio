# Phase 5 Pilot And Independent Review Protocol

Date: 2026-07-17
Status: ready for assigned reviewers and participants

## Launch Scope

Phase 5 currently evaluates DuskDS as the only production path. DuskEVM is an
educational pre-launch preview while its Testnet is unavailable; it contributes
no required source, live-smoke, or pilot evidence to the DuskDS decision. A
future DuskEVM activation requires a reviewed policy change and successful real
RPC verification before EVM evidence can become launch-gating.

The hosted Studio remains docs-only. It must state that native preflight and
scaffolding need a future full local companion distribution; hosted pilot tasks
must not imply those machine actions ran in the browser. Separately authorized
operator smoke evidence may exercise the local toolchain, but must preserve the
companion boundary and redaction rules.

## Native Smoke Gate

`.github/workflows/duskds-native-smoke.yml` is the reviewed Linux execution
path for the exact Studio commit. It runs on `ubuntu-24.04`, installs Rust
`1.94.0` and Dusk Forge commit
`d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a`, rejects a generated lockfile unless
the `dusk-core-1.6.0` tag resolves to Rusk commit
`ae1a38a2079c681126a96f94c17d282ea2639946`, and then records:

- required native tool versions;
- a bounded positive block-height/hash read from the official DuskDS Testnet
  GraphQL endpoint;
- successful scaffold and structure checks;
- separate contract and data-driver WASM sizes and SHA-256 hashes;
- a passed `dusk-forge test` VM result on Linux;
- successful artifact validation and a non-empty data-driver schema.

The workflow uses read-only repository permissions, writes sanitized evidence
to the run summary, and uploads no generated project or binary artifact. A
green run must still be bound to the Phase 5 evidence record by exact commit
and durable Actions run URL; it does not replace pilots, independent reviews,
monitoring, rollback, or product sign-off.

## Independent Reviews

### Companion security

Reviewer must be independent of the implementation and examine pairing, Origin/Host/PNA/session controls, authentication-before-parsing, disabled-by-default capabilities, rate/concurrency/body bounds, filesystem containment, atomic staging, process-tree termination, diagnostics redaction, distribution/install/cleanup, and the public/static boundary.

Evidence: reviewer identity, independence statement, reviewed commit, tests/run links, findings with P0-P3 severity, disposition, accepted exceptions, and dated acceptance.

### Platform

Reviewer examines shared-root ownership, Caddy version/security comparison, exact Studio fragment, static-only routing, TLS, CSP/headers, cache behavior, health, certificate automation, logging, Analytics isolation, listeners, release directory ownership, artifact parity, monitoring, and rollback.

Evidence: completed Caddy review packet, installed version, root/release hashes, staging receipt, listener proof, route checks, rollback result, findings, and dated acceptance.

### Accessibility

Reviewer examines keyboard completion, assistive-technology output, names/roles/live updates, contrast, focus, 200% zoom, 320px reflow, reduced motion, error recovery, desktop/mobile behavior, and both developer paths.

Evidence: browser/AT versions, tasks, results, critical findings, remediation/exception, and dated acceptance.

Implementation agents may prepare evidence but must not record these reviews as accepted on behalf of the independent reviewers.

## External Monitoring Gate

Three independently evaluated records are required:

- `monitor_heartbeat` proves the same-platform schedule guard observed a recent
  scheduled assurance run and binds its receipt to the canonical workflow and
  Actions run.
- `external_dead_man` proves an outside-GitHub heartbeat check has a fresh
  success, a verified out-of-band alert, and a recent real missed-ping
  rehearsal.
- `external_direct_health` proves a separate outside-GitHub monitor recently
  observed the exact candidate origin's `/healthz` response as HTTPS with valid
  TLS, status `200`, and body `ok`, with a recent alert-and-recovery rehearsal
  bound to a durable reference. Its timestamps must prove alert -> verified
  recovery -> later successful observation.

The two external records may use one provider account but must use distinct
check ids. Record provider/check identity, owner, exact public target, latest
successful observation, and alert evidence without committing credentials.
The Phase 5 decision remains no-go if any record is missing, stale, bound to
GitHub as its external channel, or incomplete.

## Pilot Cohort

Minimum eight observed DuskDS sessions:

- all participants exercise the DuskDS production path;
- native Rust/WASM novice and experienced developers are represented;
- Windows, WSL, Linux, and macOS contexts represented.

Use pseudonymous participant ids. Do not commit names, email addresses, wallet addresses, local paths, recordings, or raw screen captures without a separate data-handling approval.

## Tasks

### DuskDS

1. Choose the native path and explain why.
2. Explain the hosted docs-only boundary, then complete an authorized Dusk Forge/Rust/WSL preflight or recover from the injected failure.
3. Identify the correct access/API layer.
4. Scaffold and build the constrained counter starter.
5. Verify both WASM artifacts and the VM-test result separately.
6. Observe a positive block height and 64-hex hash from the official Testnet node.
7. Identify execution/finality/data-driver evidence in Inspect.
8. Use the current `/on/driver:<contract_id>/...` schema and encoding/decoding routes without signing or deployment.
9. Find source, support, and manual deploy boundaries.

Each participant receives one controlled recoverable failure. Never inject a real wallet, secret, filesystem, or network safety failure.

## Observation Record

For every session record:

- pseudonymous id, path, experience, and platform context;
- start/end and duration;
- completed outcome and evidence obtained;
- errors and whether the participant diagnosed them;
- recovery attempted/recovered;
- confusion point and whether it blocked completion;
- trust score from 1-5 and reason;
- exact copy/interaction issue;
- finding severity and owner.

## Acceptance Thresholds

- eight DuskDS sessions minimum;
- completion rate at least 83%;
- recovery rate at least 80% among attempted recoveries;
- average trust score at least 4/5;
- zero blocking confusion events;
- zero unresolved P0 or unexcepted P1.

The machine-readable thresholds live in `config/phase5-policy.json`. Summarise redacted sessions in the Phase 5 evidence JSON and validate it with `scripts/check-phase5-evidence.mjs`.
