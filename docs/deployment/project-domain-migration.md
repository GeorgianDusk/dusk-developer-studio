# Project domain migration

Owner: George
Status: prepared; blocked on one exact George-controlled FQDN

The current `studio.134-122-59-217.sslip.io` origin is a preview and is blocked
by at least one common endpoint-security path. Production must use a dedicated
project hostname controlled by George. Prefer a subdomain so DNS and rollback
remain isolated from unrelated services.

## Required decision

Record one exact lowercase FQDN, such as `studio.example.com`, and proof that
George controls its DNS. Do not use an official-organization hostname, a
wildcard, a URL path, an apex shared with unrelated services, or an unreviewed
dynamic-DNS suffix.

No DNS or Caddy cutover is authorized merely by editing this document.

## Source ownership

- This public repository is canonical for the application, release policy,
  Phase 5 host allowlist, and public monitoring.
- The private Dusk Marketing repository owns the shared VPS root, the live
  Studio Caddy fragment, Analytics isolation, deployment, and rollback.
- Analytics hostnames do not move with the Studio domain.

## Stage 1: prepare source and the exact candidate

After the FQDN is selected:

1. Add the exact hostname to `config/phase5-policy.json`; retain the preview
   hostname through the compatibility period.
2. Add the exact hostname alongside the preview alias in
   `deploy/caddy/studio.caddy` and in the private platform-owned fragment.
   Use reviewed literal hostnames, not a wildcard or runtime environment
   placeholder.
3. Make all private shared-config, static-release, and binary-maintenance smoke
   checks test the production hostname while keeping the preview as a
   compatibility check.
4. Keep CSP same-origin and preserve the prohibition on ports 5173 and 8788.
5. Leave `DUSK_STUDIO_PUBLIC_URL` and
   `DUSK_STUDIO_PUBLIC_ENVIRONMENT` on the last verified preview/staging
   deployment. Do not point scheduled monitoring at the new hostname yet.
6. Prepare two distinct external checks without marking them passed: the
   six-hour dead-man heartbeat and a paused direct HTTPS monitor for
   `https://<fqdn>/healthz`.
7. On one clean reviewed commit, complete every non-domain production-manifest
   gate, including the authorized live smoke performed against the exact
   staged candidate, then build and fingerprint the `production` artifact.
   Record its commit, manifest, assurance receipt, and rollback baseline. This
   creates a guarded candidate; it is not final production sign-off.

## Stage 2: canary DNS and Caddy

1. Create an `A` record for the FQDN to `134.122.59.217` with a short migration
   TTL. Do not create `AAAA` unless IPv6 is deliberately routed and tested.
2. Confirm authoritative and multiple public resolvers return only the intended
   address. Review CAA records if the parent zone restricts issuers.
3. Capture the active shared-Caddy configuration **A**, including its exact
   release id, root and fragment hashes, service health, and rollback baseline.
4. Run a non-mutating dry run of candidate configuration **B** with a unique
   dry-run release id. Refuse any drift from A.
5. Before the real deployment, run `-RehearseRollback` with a separate drill
   release id. It must perform **A -> B -> A** through the production restore
   function and finish with A's release id, hashes, Studio routes, and
   authenticated Analytics routes reverified.
6. Only after that rehearsal passes, deploy B once with a new live release id.
   Do not reuse either the dry-run or drill id, and do not run the rehearsal
   after the live deployment.
7. Verify the complete certificate chain, exact project and preview hostnames,
   expiry, TLS 1.2/1.3, and rejection of TLS 1.0/1.1.
8. Verify `/`, `/healthz`, receipts, SPA fallback, immutable assets, CSP, cache
   policy, log privacy, closed ports, both Studio aliases, and both
   authenticated Analytics routes.
9. Test the new hostname from George's normal Chrome plus Bitdefender path. Do
   not add a security exception to make the test pass.
10. Keep repository monitoring variables unchanged throughout the canary. If
   any check fails, restore the prior shared configuration; do not deploy the
   production artifact.

## Stage 3: deploy and verify the guarded production candidate

1. Capture the active versioned release **A**, including its release id,
   manifest fingerprint, health proof, and rollback target. Refuse drift from
   that baseline.
2. Before promotion, run the static deployer's rollback-rehearsal mode with the
   exact fingerprinted candidate **B** from Stage 1. The rehearsal must perform
   **A -> B -> A**, invoke the same restore function used after a failed live
   smoke, and finish with A active and independently reverified. A rehearsal
   failure is a stop condition; do not leave B active and do not continue.
3. Only after the A -> B -> A rehearsal passes, use a new release id for the
   one real deployment of B. Do not reuse the rehearsal release, rebuild the
   artifact, or perform an extra untracked switch.
4. Immediately dispatch public assurance with explicit inputs
   `target_url=https://<fqdn>` and `expected_environment=production`. The
   repository defaults still point at the previous verified deployment, so a
   failed candidate cannot silently become the scheduled target.
5. Verify exact commit/artifact parity, routes, TLS, cache and security headers,
   source and RPC state, controlled RPC degradation, browser flows, closed
   ports, log privacy, and Analytics isolation.
6. If the real B deployment or manual assurance fails, create one new versioned
   rollback release from the retained exact A artifact. Use a unique rollback
   release id, pass `-ExpectedCurrentReleaseId '<B-release-id>'`, and pin
   `-ExpectedCommit` and `-ExpectedEnvironment` to A. After the guarded switch,
   verify
   the rollback release serves A's exact manifest fingerprint and file content,
   health, routes, and cache behavior through both the project hostname and the
   preview alias. Verify the active symlink names the new rollback release; do
   not claim that A's original release id was reactivated. Leave repository
   variables and external monitors unchanged. An unverified or ad-hoc file copy
   is not an acceptable rollback.

## Stage 4: activate scheduled and external monitoring

Only after Stage 3 passes:

1. Set `DUSK_STUDIO_PUBLIC_URL=https://<fqdn>` and
   `DUSK_STUDIO_PUBLIC_ENVIRONMENT=production` in the same controlled cutover.
2. Activate the separate direct monitor for `https://<fqdn>/healthz`; require
   valid TLS, status `200`, and body `ok`.
3. Observe a fully successful scheduled assurance run and its external success
   heartbeat. Confirm the same-platform schedule guard records the canonical
   workflow run.
4. Verify the direct health monitor's out-of-band alert and recovery, record
   `recovery_verified=true` and `recovered_at`, then observe a later successful
   `/healthz` check so the record proves alert -> recovery -> latest success.
   Separately perform and recover from the real dead-man missed-ping rehearsal.
5. Record three distinct, fresh Phase 5 entries: `monitor_heartbeat`,
   `external_dead_man`, and `external_direct_health`. The two external checks
   may share a provider account but must have distinct check ids.
6. If scheduled or external monitoring fails, the promotion remains no-go.
   Restore the prior repository variables, and roll back the static artifact
   when the failure concerns the candidate rather than only an external
   provider.

## Stage 5: final sign-off and compatibility period

Run the Phase 5 evaluator only after Stages 1-4 have produced their exact
evidence. Final sign-off occurs after the evaluator passes; it is not a
precondition for deploying the guarded candidate needed to collect live
evidence.

Keep the preview alias during the agreed compatibility window. Remove it only
through another reviewed Caddy change after monitoring and rollback evidence
for the project domain is complete.

## Stop conditions

Stop or restore if DNS differs from the recorded target, Caddy cannot obtain a
valid certificate, either Studio origin loses required headers or cache rules,
the artifact differs from its manifest, Analytics loses its login boundary,
ports 5173/8788 accept connections, the protected-client test is blocked, or
automatic rollback cannot restore the previous release.
