# Public deployment monitoring

Owner: George

This control treats `https://studio.134-122-59-217.sslip.io` as the approved
GeorgianDusk production target when
`DUSK_STUDIO_PUBLIC_ENVIRONMENT=production`.

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

- file-backed public health;
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
GitHub Actions or Issues outage can stop both controls. The primary scheduled
workflow therefore sends successful scheduled runs to the HTTPS URL stored in
`STUDIO_MONITOR_HEARTBEAT_URL`. Known failed scheduled runs call the separate
HTTPS URL in `STUDIO_MONITOR_HEARTBEAT_FAIL_URL`; runs that never start are
still detected by the provider's missed-ping deadline. Never print either URL
or put it in repository variables, artifacts, issues, or logs.

Provision two separate external checks:

1. A dead-man heartbeat expected every six hours with a two-hour grace period,
   routed to George by email or another non-GitHub channel.
2. A direct HTTPS keyword monitor for
   `https://studio.134-122-59-217.sslip.io/healthz` that
   requires status `200`, body `ok`, and valid TLS.

Better Stack's personal-project free tier is the current recommended one-account
option because it supports both check types and explicit success/failure
heartbeat endpoints. Provider choice remains George's decision and must be
reassessed if the project no longer fits personal-project terms.

Production remains no-go until George provisions the provider, enables account
MFA, and records both external checks with distinct check ids. The
`external_dead_man` record requires a fresh success plus a real missed-ping
alert and recovery from the preceding 30 days. The `external_direct_health`
record requires a fresh observation of the exact production `/healthz` URL with
valid TLS, status `200`, body `ok`, and a recent recorded out-of-band alert and
recovery rehearsal. Its evidence must set `recovery_verified`, record
`recovered_at`, and prove the chronology alert -> recovery -> latest successful
health observation; a success seen before recovery does not close the gate.
The same-platform `monitor_heartbeat` record separately needs its exact
workflow path, Actions run URL, observation time, and receipt digest. None of
these three records substitutes for another.

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
