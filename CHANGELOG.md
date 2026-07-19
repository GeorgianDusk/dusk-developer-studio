# Changelog

All notable Dusk Developer Studio changes are recorded here. The release manifest remains the source of truth for exact built artifact identity.

## Unreleased

- Make `studio.134-122-59-217.nip.io` the canonical production origin after a protected DNS path rewrote the former `sslip.io` hostname; retain the old origin only as a temporary same-release compatibility route.
- Add a deterministic Windows/Linux portable companion RC pipeline with pinned Node runtime verification, payload manifests, SBOM, provenance, signing gates, and extracted-archive smoke.
- Keep hosted artifacts docs-only while adding release-bound portable bootstrap, exact Studio/runtime parity, safe-mode default, and separate local-actions launchers.
- Strip secret-shaped environment variables from child tools and terminate active tracked process groups during shutdown; deliberately detached same-user tool daemons remain outside this guarantee.
- Record the accepted same-user tool boundary, add source-only support and
  withdrawal procedures, and require native unsigned engineering assurance
  that keeps full evidence and candidates runner-local, retains only bounded
  status output in Actions logs, and uploads no workflow artifacts.
- Reject elevated Windows and privileged Linux/macOS companion launches before
  extraction, including POSIX user/group identity mismatches and Linux
  permitted, effective, or ambient capabilities, and exercise the Windows
  unsigned lifecycle under a temporary standard local user without a product
  or CI bypass.

- Lock the production contract, launch gates, security ownership, and docs-only hosted fallback.
- Add release version and clean/dirty commit visibility plus fail-closed production artifact-digest parity verification.
- Restrict interactive EVM actions to Testnet while keeping Mainnet and Devnet as labeled references.
- Separate Windows PowerShell build guidance from Ubuntu WSL VM tests for DuskDS.
- Classify RPC failures and make source maturity and freshness visible in developer references.
