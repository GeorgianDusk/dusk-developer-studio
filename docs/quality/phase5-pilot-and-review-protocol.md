# Phase 5 Pilot And Independent Review Protocol

Date: 2026-07-15
Status: ready for assigned reviewers and participants

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

## Pilot Cohort

Minimum eight observed sessions:

- at least three DuskEVM developers;
- at least three native Rust/WASM developers;
- novice and experienced participants represented;
- Windows, WSL, Linux, and macOS contexts represented.

Use pseudonymous participant ids. Do not commit names, email addresses, wallet addresses, local paths, recordings, or raw screen captures without a separate data-handling approval.

## Tasks

### DuskEVM

1. Choose the correct path and explain why.
2. Complete Setup with RPC/wallet read-only evidence or recover from the injected failure.
3. Find the approved Testnet access route.
4. Create/build the Foundry starter locally.
5. Use Inspect for a supplied non-sensitive Testnet identifier.
6. Find source, support, and local-companion boundaries.

### Native

1. Choose the native path and explain why.
2. Complete Dusk Forge/Rust/WSL preflight or recover from the injected failure.
3. Identify the correct access/API layer.
4. Scaffold and build the constrained counter starter.
5. Identify execution/finality/data-driver evidence in Inspect.
6. Find source, support, and manual deploy boundaries.

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

- eight sessions minimum, with at least 3/3 path coverage;
- completion rate at least 83%;
- recovery rate at least 80% among attempted recoveries;
- average trust score at least 4/5;
- zero blocking confusion events;
- zero unresolved P0 or unexcepted P1.

The machine-readable thresholds live in `config/phase5-policy.json`. Summarise redacted sessions in the Phase 5 evidence JSON and validate it with `scripts/check-phase5-evidence.mjs`.
