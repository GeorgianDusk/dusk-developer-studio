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

The manual signed-RC workflow builds only from the selected protected tag, uses immutable action SHAs, verifies platform trust on fresh hosted runners, and uploads private workflow artifacts plus evidence. It has no push trigger, package publication, GitHub Release creation, deployment, or public-download step.

`config/companion-standalone-signing-policy.json` remains fail-closed: `publication_enabled` is `false`, and Windows/Apple identity fields remain blank until real identities are configured and reviewed.

## Publication gates

A public binary release requires all of the following for the exact final hashes:

1. A clean tagged commit and passing source, secret, dependency, unit, build, browser, and platform gates.
2. Valid Windows publisher identity and timestamp, Linux Sigstore bundle and transparency evidence, and Apple Developer ID/notarization/stapling evidence.
3. Fresh-machine installation, self-test, closed-port, cleanup, uninstall, quarantine, and reputation checks on supported operating systems.
4. Independent companion security review and resolution of every release-blocking finding.
5. Documented support owner, incident route, rollback procedure, and compatibility statement.
6. Explicit maintainer approval to change `publication_enabled` and a separately reviewed publication workflow.

Until those gates pass, GitHub source is the canonical distribution. Developers may run a reviewed source checkout, but no unsigned executable should be promoted as a trusted download.
