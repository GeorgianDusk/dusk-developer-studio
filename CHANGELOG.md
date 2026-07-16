# Changelog

All notable Dusk Developer Studio changes are recorded here. The release manifest remains the source of truth for exact built artifact identity.

## Unreleased

- Add a deterministic Windows/Linux portable companion RC pipeline with pinned Node runtime verification, payload manifests, SBOM, provenance, signing gates, and extracted-archive smoke.
- Keep hosted artifacts docs-only while adding release-bound portable bootstrap, exact Studio/runtime parity, safe-mode default, and separate local-actions launchers.
- Strip secret-shaped environment variables from child tools and terminate active process trees during shutdown.

- Lock the production contract, launch gates, security ownership, and docs-only hosted fallback.
- Add release version and clean/dirty commit visibility plus fail-closed production artifact-digest parity verification.
- Restrict interactive EVM actions to Testnet while keeping Mainnet and Devnet as labeled references.
- Separate Windows PowerShell build guidance from Ubuntu WSL VM tests for DuskDS.
- Classify RPC failures and make source maturity and freshness visible in developer references.
