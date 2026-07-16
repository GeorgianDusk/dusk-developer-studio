# Public staging monitoring

Owner: George

The `Studio public staging assurance` workflow runs every six hours and can
also be dispatched manually. Scheduled runs always target
`https://studio.134-122-59-217.sslip.io` as a staging release and bind public
release parity to the exact `main` commit checked out by the run.

## Checks

- file-backed public health;
- exact release, assurance receipt, and artifact hashes;
- root and SPA-fallback identity and `no-cache` behavior;
- immutable asset and no-store receipt caching;
- source-link availability;
- DuskEVM Testnet chain ID;
- controlled browser recovery when the RPC is unavailable;
- TLS certificate lifetime;
- closed public ports 5173 and 8788;
- desktop and mobile public browser flows.

The bounded JSON synthetic receipt is retained as a workflow artifact for 30
days. It contains URLs, release identity, check results, and failure messages,
not wallet data, local paths, credentials, or raw browser traces.

## Alert channel

A failed scheduled run opens or updates the public issue
`Studio staging synthetic assurance failed` and assigns it to
`GeorgianDusk`. A later successful scheduled run closes the active issue with
the recovery-run link. This keeps one durable incident thread instead of
creating a new issue every six hours.

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
workflow therefore sends a success-only HTTPS heartbeat through the
`STUDIO_MONITOR_HEARTBEAT_URL` repository secret. Production remains no-go
until George provisions that URL with an external dead-man service, routes its
missed-ping alert outside GitHub, rehearses the missed-ping alert, and records
the evidence as the `external_dead_man` synthetic check in the Phase 5 packet.
Do not record the check as passed without the external provider and check id,
a fresh success observation, the out-of-band alert channel, and a missed-ping
rehearsal from the preceding 30 days. The same-platform guard separately needs
its exact workflow path, Actions run URL, observation time, and receipt digest.

## Response

1. Open the linked workflow run and bounded synthetic receipt.
2. Distinguish Studio release/configuration failure from official upstream RPC
   or source availability failure.
3. For release parity, cache, route, TLS, listener, or artifact failures, stop
   promotion and use the versioned static rollback procedure.
4. For an upstream RPC failure, confirm that the browser degradation test still
   passes, keep the incident visible, and do not misrepresent upstream status
   as a Studio deployment failure.
5. Close an alert only through a passing scheduled recovery run or with a
   documented false-positive disposition and follow-up fix.
