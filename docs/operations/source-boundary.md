# Source Boundary

This directory is the canonical source for Dusk Developer Testnet Studio.

## Versioned source

- application, package, script, test, deployment, and documentation files in this directory;
- lockfiles and deterministic configuration required to rebuild and validate the product;
- public examples such as `.env.example` that contain names and placeholders only.

## Local-only runtime material

Do not commit dependencies, build outputs, caches, test artifacts, local-agent state, generated output, environment files, credentials, keys, or wallet material. The `.gitignore` and `check:no-secrets` gate enforce this boundary.

The former top-level `Dusk Developer Testnet Studio` workspace copy is a temporary rollback source during migration. Once the monorepo copy has passed all gates and recovery has been rehearsed, new source changes must begin here.

## Required validation

From this directory, run:

```powershell
pnpm install --frozen-lockfile
pnpm check:no-secrets
pnpm check:freshness
pnpm check:boundary
pnpm verify:local
pnpm e2e
```
