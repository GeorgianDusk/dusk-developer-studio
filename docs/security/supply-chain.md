# Reproducible runtime and container provenance

The Studio keeps its existing npm release provenance and adds a separate contract for the Hosted guide container and production application dependencies.

## Reviewed inputs

- Node.js is fixed to `24.18.0` in assurance workflows and pnpm is fixed to `11.7.0` through `package.json` and CI.
- `pnpm-lock.yaml` remains the frozen package-resolution source.
- Both Docker stages use a readable tag plus an immutable multi-platform SHA-256 digest. The runtime stage follows the maintained Nginx stable-Alpine line rather than the obsolete 1.27 line.
- The runtime's OpenSSL libraries are upgraded to exact Alpine security versions, with the package names and versions bound into the reviewed policy and Dockerfile contract.
- `config/supply-chain-policy.json` binds those versions, package upgrades, digests, scanner versions, severity gates, and evidence locations as one exact contract.
- `provenance/studio-production-dependencies.cdx.json` is a deterministic CycloneDX 1.6 inventory generated from the installed production dependency graph and bound to the pnpm lock and Dockerfile hashes.

## Local checks

After `pnpm install --frozen-lockfile`:

```bash
pnpm supply-chain:check
pnpm supply-chain:audit -- --output output/supply-chain/studio-npm-audit.json
```

Use `pnpm supply-chain:sbom` only for an intentional lock or container-input update, then review and commit the regenerated SBOM. `pnpm supply-chain:check` fails if the SBOM, lock, package-manager pin, Docker stages, digests, or runtime package pins drift.

## CI evidence and failure policy

The production-assurance workflow:

1. installs the frozen pnpm graph;
2. verifies the committed application SBOM and runs the production-only npm audit at `moderate` severity or higher;
3. builds the Hosted guide from the digest-pinned bases without a build cache;
4. generates a container CycloneDX SBOM with Trivy `v0.70.0` through an immutable action commit; and
5. fails on any unresolved `HIGH` or `CRITICAL` operating-system or library vulnerability.

The application and container receipts are retained as workflow artifacts for 30 days. There are no silent vulnerability exceptions. A future exception requires an explicit policy/schema change, owner, rationale, expiry, tests, and review.

Updating a base image means resolving a maintained tag to its current multi-platform digest, changing the policy and Dockerfile together, rebuilding, scanning, and smoke-testing `/healthz`. A runtime security-package update also changes the exact policy pins and Dockerfile install line together. Neither kind of change is applied automatically.
