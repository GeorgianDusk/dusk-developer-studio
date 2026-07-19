# Hosted guide monitoring

The GeorgianDusk deployment is monitored at:

```text
https://studio.134-122-59-217.nip.io
```

The `Studio public deployment assurance` workflow runs every six hours and can also be dispatched manually. It fails closed unless the target is one exact approved HTTPS origin and the public artifact matches the checked source identity.

## What is checked

- `/healthz` returns HTTPS status `200` and body `ok`;
- release manifest, assurance receipt, and artifact hashes agree;
- root and SPA fallback serve the same release;
- HTML and receipts use no-cache or no-store behavior;
- hashed assets use immutable caching;
- DuskDS source links remain reachable;
- the official DuskDS Testnet GraphQL endpoint returns a valid recent block height and hash;
- DuskEVM RPC availability remains explicitly deferred while its Testnet is not live;
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

Expected DuskEVM pre-launch unavailability does not open an incident or fail the DuskDS deployment check. Activating DuskEVM monitoring requires a verified DuskEVM Testnet RPC and current EVM browser and network checks.

## Schedule guard

`Studio same-platform monitor schedule guard` runs separately and reports when the assurance workflow is missing, disabled, has never run on schedule, or has no recent scheduled run.

Both controls use GitHub Actions and GitHub Issues. A repository-wide GitHub outage can affect monitoring and alert delivery at the same time. Reassess that dependency after a monitoring-blindness incident, a service-level commitment, time-critical use, or material growth in external developer usage.

## Incident response

1. Open the linked workflow run and bounded receipt.
2. Distinguish Studio release or configuration failure from DuskDS upstream unavailability.
3. For release identity, cache, route, TLS, listener, or artifact failure, stop deployment and restore the last verified static artifact.
4. For a required DuskDS upstream failure, keep the issue visible without presenting the upstream outage as a Studio defect.
5. Independently confirm that expected DuskEVM RPC degradation still behaves safely.
6. Close an alert only after a passing recovery run or a documented false-positive fix.

Monitoring covers the public Hosted guide. The local npm-launched Studio is validated through package and cross-platform checks rather than a public endpoint.
