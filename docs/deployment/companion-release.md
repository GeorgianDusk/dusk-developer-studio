# Companion release policy

Status: source available; public companion binaries disabled.

The companion is a local, loopback-only runtime for allowlisted preflight checks and starter scaffolding. The preferred binary format is one Node SEA executable per target: Authenticode-signed Windows x64, Sigstore-attested Linux x64, and Developer ID signed/notarized Apple Silicon macOS.

## Canonical identity

- Repository: `GeorgianDusk/dusk-developer-studio`
- Workflow: `.github/workflows/studio-companion-signed-rc.yml`
- Protected environment: `studio-companion-signing`
- Tag pattern: `studio-companion-vX.Y.Z-rc.N`
- Linux certificate identity: `https://github.com/GeorgianDusk/dusk-developer-studio/.github/workflows/studio-companion-signed-rc.yml@refs/tags/{release_tag}`
- OIDC issuer: `https://token.actions.githubusercontent.com`

The Linux identity is supplied by GitHub OIDC and Sigstore. Windows and Apple identities must belong to the independent maintainer or their chosen legal publishing entity; they must never use or imply a Dusk Network/Foundation identity.

## Current workflow boundary

The manual signed-RC workflow is intentionally blocked at readiness. It resolves the selected protected tag to one immutable workflow commit and every checkout uses that commit, but no private signed-candidate transport has been implemented. Candidate binaries must never use GitHub Actions artifacts or draft releases; the workflow leaves any locally produced candidate on its signing runner and fails before transport. Only bounded JSON evidence may use Actions artifacts after a future reviewed transport makes fresh-runner checks possible.

`config/companion-standalone-signing-policy.json` remains fail-closed: `publication_enabled` and `candidate_transport.enabled` are `false`, the transport provider is `none`, and Windows/Apple identity fields remain blank until real identities and a separately reviewed private transport are configured.

## Publication gates

A public binary release requires all of the following for the exact final hashes:

1. A clean tagged commit and passing source, secret, dependency, unit, build, browser, and platform gates.
2. Valid Windows publisher identity and timestamp, Linux Sigstore bundle and transparency evidence, and Apple Developer ID/notarization/stapling evidence.
3. A separately reviewed private candidate transport that prevents public access and binds every transfer to the exact candidate digest. GitHub Actions artifacts and draft releases are not approved candidate transports.
4. Fresh-machine installation, self-test, closed-port, cleanup, uninstall, quarantine, and reputation checks on supported operating systems.
5. Independent companion security review and resolution of every release-blocking finding.
6. Documented support owner, incident route, rollback procedure, and compatibility statement.
7. Explicit maintainer approval to change `publication_enabled` and a separately reviewed publication workflow.

Until those gates pass, GitHub source is the canonical distribution. Developers may run a reviewed source checkout, but no unsigned executable should be promoted as a trusted download.
