# Hosted guide monitoring

The GeorgianDusk deployment is monitored at:

```text
https://studio.134-122-59-217.nip.io
```

The `Studio public deployment assurance` workflow can be dispatched manually. It fails closed unless the target is one exact approved HTTPS origin and the public artifact matches the checked source identity.

## Pre-launch schedule pause

Scheduled public monitoring is intentionally paused as of August 16, 2026 while the hosted Studio is not expected to track every commit on `main`. The assurance and schedule-guard workflows remain available for manual dispatch; their implementation has not been removed.

Before the public launch:

1. Deploy the intended release from current `main` to the approved public origin.
2. Restore this block under `on` in `.github/workflows/studio-public-staging.yml`:

   ```yaml
   schedule:
     - cron: "23 */6 * * *"
   ```

3. Observe a successful scheduled assurance run and confirm that its release identity matches the deployed commit.
4. Restore this block under `on` in `.github/workflows/studio-monitor-schedule-guard.yml`:

   ```yaml
   schedule:
     - cron: "47 4,16 * * *"
   ```

5. Confirm the schedule guard passes and that assigned GitHub issue alert delivery still works.

Do not restore the schedule guard by itself: it intentionally reports a stale heartbeat when the public assurance schedule is inactive.

## What is checked

- `/healthz` returns HTTPS status `200` and body `ok`;
- release manifest, assurance receipt, and artifact hashes agree;
- root and SPA fallback serve the same release;
- HTML and receipts use no-cache or no-store behavior;
- hashed assets use immutable caching;
- DuskDS source links remain reachable;
- the official DuskDS Testnet GraphQL endpoint returns a valid recent block height and hash;
- the DuskEVM RPC reports chain `0x2e9`, the reviewed genesis hash, and a progressing head;
- the DuskEVM browser journey fails safely when RPC is unavailable;
- the TLS certificate has sufficient remaining lifetime;
- public ports 5173 and 8788 are closed; and
- desktop and mobile browser flows pass.

Requests reject redirects, unexpected final URLs, user information, non-default ports, paths, queries, and fragments in the configured origin.

The bounded workflow receipt contains release identity, URLs, check results, and sanitized failure messages. It must not contain wallet data, local paths, credentials, browser cookies, or pairing material.

## Alert behavior

A failed scheduled run distinguishes:

- a Studio, platform, monitoring, browser, or unclassified failure; and
- an unavailable required DuskDS source or public-node dependency.

The workflow opens or updates one assigned GitHub issue for the active failure category. A later successful scheduled run closes the incident with the recovery-run link.

DuskEVM wrong-chain, wrong-genesis, frozen-head, unreachable, malformed, CORS, or expired-identity results fail the active DuskEVM gate. Degrade by disabling the DuskEVM activation flag and restoring the inert review-required boundary; DuskDS remains independently available when its own checks pass.

## Schedule guard

When scheduled monitoring is active, `Studio same-platform monitor schedule guard` runs separately and reports when the assurance workflow is missing, disabled, has never run on schedule, or has no recent scheduled run. Its schedule is paused during the documented pre-launch period above.

Both controls use GitHub Actions and GitHub Issues. A repository-wide GitHub outage can affect monitoring and alert delivery at the same time.

The GitHub-only model was reassessed on July 19, 2026 after the npm package became public. It remains the accepted monitoring model for this personal project, and third-party monitoring remains intentionally deferred. Reassess this choice after a monitoring-blindness incident, a service-level or commercial commitment, or material growth in external developer usage.

## Incident response

1. Open the linked workflow run and bounded receipt.
2. Distinguish Studio release or configuration failure from DuskDS upstream unavailability.
3. For release identity, cache, route, TLS, listener, or artifact failure, stop deployment and restore the last verified static artifact.
4. For a required DuskDS upstream failure, keep the issue visible without presenting the upstream outage as a Studio defect.
5. Recheck DuskEVM chain, genesis, progression, explorer, and browser recovery. If identity or availability is uncertain, disable DuskEVM live controls before restoring public service.
6. Close an alert only after a passing recovery run or a documented false-positive fix.

Monitoring covers the public Hosted guide. The local npm-launched Studio is validated through package and cross-platform checks rather than a public endpoint.
