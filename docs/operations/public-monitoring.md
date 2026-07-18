# Public deployment monitoring

Owner: George

This control treats `https://studio.134-122-59-217.nip.io` as the approved
GeorgianDusk production target when
`DUSK_STUDIO_PUBLIC_ENVIRONMENT=production`.
The previous `sslip.io` origin temporarily serves the same static release for
compatibility, but it is outside `candidate_hosts` and scheduled assurance does
not use it because some protected DNS paths rewrite that domain to a block page
before reaching the Studio.

The `Studio public deployment assurance` workflow runs every six hours and can
also be dispatched manually. Manual runs inherit the repository target and
environment unless the operator explicitly supplies an approved URL or selects
an environment override; there is no hard-coded preview default. Every run
fails closed unless it resolves an approved deployment from repository
variables `DUSK_STUDIO_PUBLIC_URL` and `DUSK_STUDIO_PUBLIC_ENVIRONMENT` or from
the manual inputs `target_url` and `expected_environment`. Public release parity
remains bound to the exact `main` commit checked out by the run.

The current production scope is DuskDS. DuskEVM remains an educational
pre-launch preview because its Testnet is not live. The scheduled receipt
records `rpc_chain_id` as `deferred`; that expected state is excluded from the
DuskDS production classification and heartbeat. The hosted browser's
controlled DuskEVM RPC-degradation behavior remains required so the preview
fails safely rather than implying network readiness.

Before Playwright or any target request runs, the workflow requires one exact
allowlisted HTTPS origin. User information, a non-default port, path, query, or
fragment is rejected. The synthetic runner reuses the same validation, so HTTP
and TLS evidence cannot be collected from different origins. Studio health,
HTML, receipts, fallback, and artifact requests use manual redirect handling
and reject every redirect or final-URL change. Playwright API requests also set
zero redirects; browser navigation blocks cross-origin requests before sending
them and rejects any observed redirect chain or unexpected final URL.

## Checks

- file-backed public health at
  `https://studio.134-122-59-217.nip.io/healthz`, requiring HTTPS, status
  `200`, and body `ok`;
- exact release, assurance receipt, and artifact hashes;
- root and SPA-fallback identity and `no-cache` behavior;
- immutable asset and no-store receipt caching;
- DuskDS-only source-link availability;
- a bounded read from the official DuskDS Testnet GraphQL endpoint, requiring
  a positive safe-integer height and an exact 64-hex block hash;
- an explicit bounded `deferred` receipt for the unavailable DuskEVM Testnet
  chain-ID check;
- controlled browser recovery when the RPC is unavailable;
- TLS certificate lifetime;
- closed public ports 5173 and 8788;
- desktop and mobile public browser flows.

The bounded JSON synthetic receipt is retained as a workflow artifact for 30
days. It contains URLs, release identity, check results, and failure messages,
not wallet data, local paths, credentials, or raw browser traces.

## Alert channel

A failed scheduled run distinguishes the Studio from its upstream dependency:

- `Studio public deployment assurance failed` means a Studio, platform,
  monitoring, browser, or unclassified check failed.
- `Studio upstream dependency unavailable` means the Studio checks and hosted
  browser flow passed while a required DuskDS source or the official DuskDS
  Testnet node read failed. Any browser failure is classified as a Studio
  deployment incident, even when an upstream check also failed.

The issue is assigned to `GeorgianDusk`. On every failed scheduled run, the
workflow first opens or updates the selected component incident, then closes
and links any open incident under the other current or legacy component title.
Exactly one Studio/upstream component title therefore remains active. A later
fully successful scheduled run closes either active incident with the
recovery-run link. Expected DuskEVM pre-launch unavailability does not open an
incident or fail DuskDS production assurance. Activating DuskEVM requires a
reviewed policy change that moves `evm` into `production_paths`, removes the
deferral, restores `rpc_chain_id` as a required check, verifies the real
DuskEVM Testnet RPC, and supplies current EVM smoke and pilot evidence.

The manual `verify_alert_delivery` input creates, assigns, records, and closes
a clearly labeled harmless rehearsal issue. Preserve the resulting
`studio-alert-delivery-receipt-<run-id>` artifact in the Phase 5 packet. Do
not mark alert delivery verified until that exact run and assigned issue have
been observed.

## Same-platform schedule guard

`Studio same-platform monitor schedule guard` runs twice daily, separately from the
public assurance workflow. It queries the GitHub Actions API and opens the
assigned `Studio monitoring heartbeat is stale` issue when the assurance
workflow is missing, disabled, has never run on schedule, or has no scheduled
run within 15 hours. It stores only a bounded JSON heartbeat receipt.

This is workflow-level separation, not platform independence: a repository-wide
GitHub Actions or Issues outage can stop both controls. George explicitly
accepts that residual risk for this personal project in
[github-only-monitoring-decision.md](github-only-monitoring-decision.md).

The public workflow does not call a third-party heartbeat, store provider
secrets, or require an external direct-health service. A scheduled browser or
synthetic failure opens or updates the assigned component issue; a later fully
successful scheduled run closes it. The separate schedule guard detects a
missing, disabled, or stale assurance schedule from inside GitHub.

Phase 5 requires one `monitor_heartbeat` record with the exact schedule-guard
workflow path, canonical Actions run URL, observation time, and receipt digest.
It also requires the existing assigned-issue alert-delivery rehearsal. External
dead-man and direct-health records are not required under
`monitoring_evidence.mode=github-only`.

Production remains no-go when the canonical assurance workflow is disabled,
the schedule-guard receipt is missing or stale, GitHub alert delivery is not
verified, or either GitHub check is treated as best-effort. Revisit the
third-party-monitoring decision before public companion distribution,
service-level commitments, time-critical use, a monitoring-blindness incident,
or material growth in external developer usage.

## Optional future domain transition

Before changing scheduled monitoring from the current production origin to a
future replacement hostname, follow
[project-domain-migration.md](../deployment/project-domain-migration.md). Add
the exact hostname to the Phase 5 allowlist in the same reviewed commit, canary
the domain, deploy the fingerprinted production candidate, and pass explicit
manual assurance and rollback before setting the two repository variables.
Never relax the candidate-host policy to accept arbitrary HTTPS origins or set
scheduled defaults merely because DNS and TLS are live.

## Response

1. Open the linked workflow run and bounded synthetic receipt.
2. Distinguish Studio release/configuration failure from official DuskDS node
   or source availability failure.
3. For release parity, cache, route, TLS, listener, or artifact failures, stop
   promotion and use the versioned static rollback procedure.
4. For a required DuskDS upstream failure, keep the incident visible and do not
   misrepresent upstream status as a Studio deployment failure. The expected
   DuskEVM pre-launch RPC deferral opens no incident; independently confirm its
   browser degradation test still passes.
5. Close an alert only through a passing scheduled recovery run or with a
   documented false-positive disposition and follow-up fix.
