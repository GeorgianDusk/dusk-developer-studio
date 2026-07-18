# Companion release policy

Status: source available; public companion binaries disabled.

The companion is a local, loopback-only runtime for allowlisted preflight checks and starter scaffolding. Each target has two mode-bound Node SEA entrypoints built from the same verified payload: **Safe** and **Local Actions**. Safe refuses command-line escalation; Local Actions enables its bounded capabilities internally, so users choose an explicit launcher instead of passing a magic flag. Windows x64 requires both executables to be Authenticode signed, Linux x64 requires both to be Sigstore attested, and Apple Silicon macOS packages separately identified Safe and Local Actions app bundles together after Developer ID signing and notarization.

## Canonical identity

- Repository: `GeorgianDusk/dusk-developer-studio`
- Workflow: `.github/workflows/studio-companion-signed-rc.yml`
- Protected environment: `studio-companion-signing`
- Tag pattern: `studio-companion-vX.Y.Z-rc.N`
- Linux certificate identity: `https://github.com/GeorgianDusk/dusk-developer-studio/.github/workflows/studio-companion-signed-rc.yml@refs/tags/{release_tag}`
- OIDC issuer: `https://token.actions.githubusercontent.com`

The Linux identity is supplied by GitHub OIDC and Sigstore. Windows and Apple identities must match the publisher identities committed in the release policy.

## Staged decision model

Release decisions are deliberately separate so evidence can be collected without weakening a later gate:

1. **Source, build, and signing readiness** validates the exact repository, protected tag, workflow, target matrix, runner labels, launcher contract, and configured platform identities. It does not depend on transport or publication.
2. **Candidate transport readiness** remains blocked in policy schema 2. No enabled provider is accepted merely because it has a name or review URL; a later version must define and test one exact transport protocol.
3. **Signed-candidate acceptance** validates one ZIP per OS, two distinct mode-bound launchers, every platform check, the unsigned and signed launcher indexes, the allowlisted package manifest, and the retained full lifecycle report. Lifecycle evidence is scoped to Studio-owned listeners, fixed-port shutdown, and runner-owned install/extraction rollback; it does not claim machine-wide containment of deliberately detached processes from an invoked same-user tool. Every target record is bound to the repository, tag-bound workflow, run ID, run attempt, workflow actor, and a bounded creation time. Candidate acceptance is allowed while publication remains disabled.
4. **Publication-dossier review** checks the shape and timing of a security review, tested support route, exact compatibility matrix, rollback/revocation drill, reputation/quarantine evidence, monitoring revisit, and explicit approval bound to the SHA-256 of the exact signed-candidate evidence bytes. Policy schema 2 deliberately rejects every dossier because authenticated gate-artifact bytes and authenticated reviewer identities are not implemented yet.
5. **Publication readiness** combines every prior decision with the final `publication_enabled` switch. Schema 2 cannot return `go` because it approves no candidate transport.

The publication-dossier validator rejects extra fields, stale or future-dated evidence, evidence without a recorded SHA-256, an expired monitoring revisit, and review/approval attributed to the same claimed GitHub actor. Those checks are review aids, not authentication: schema 2 does not fetch and hash referenced artifacts or prove actor identity, so it cannot return an accepted publication decision. Candidate evidence is valid for at most 30 days and the allowed clock skew is five minutes.

## Current workflow boundary

The manual signed-RC workflow is intentionally blocked before transport. It
resolves the selected protected tag to one immutable workflow commit and every
checkout uses that commit, but no private signed-candidate transport has been
implemented. Today, readiness fails because the Windows and Apple identities
are unconfigured, so the signing jobs are skipped and no candidate package is
built. If those identities are configured later, each signing runner will
assemble one strict forward-slash ZIP for its OS containing both mode-bound
launchers, the exact signed-launcher index, the unsigned build receipt, and a
complete allowlisted package manifest. Fresh runners must validate the ZIP
central directory, bounds, paths, file types, modes, CRCs, digests, and manifest
before materializing or executing any entry. Candidate packages must never use
GitHub Actions artifacts or draft releases; even after identities are
configured, each signing job leaves its package runner-local and fails before
transport. Only bounded, current-attempt JSON evidence may use Actions artifacts
after a future reviewed transport makes fresh-runner checks possible.

`config/companion-standalone-signing-policy.json` remains fail-closed: `publication_enabled` and `candidate_transport.enabled` are `false`, the transport provider is `none`, and Windows/Apple identity fields are intentionally blank under the current source-only distribution decision.

George accepts the documented same-user tool-authority and detached-process
boundary for the current source-only and internal companion scope, with
compensating controls and explicit revisit triggers recorded in
[the boundary decision](../security/same-user-tool-boundary-decision.md). This
maintainer decision does not constitute independent security acceptance,
candidate approval, or publication approval.

## Unsigned engineering assurance

`.github/workflows/studio-companion-unsigned-assurance.yml` is a separate
engineering lane, not a release workflow. On fresh GitHub-hosted Windows x64,
Linux x64, and macOS arm64 runners, it builds both launchers twice, verifies
their reproducible receipt and digest boundary, creates and strictly extracts a
runner-local unsigned package, exercises Safe and Local Actions through the
bounded lifecycle harness, performs native platform observations, and deletes
every enumerated workflow-owned candidate path before recording evidence.
Linux and macOS native jobs prove root-launch rejection. Canonical unit tests
and launcher source-contract tests separately verify POSIX identity-mismatch
handling and Linux capability-field handling. Because the Windows hosted runner
is elevated, it first proves elevated rejection and then executes the exact
lifecycle as a temporary standard local user inside an ACL-isolated runner root,
without a product or CI bypass.

The workflow keeps full evidence records and all candidate files inside each
ephemeral native runner and uploads no workflow artifacts. Ordinary bounded
status output remains in GitHub Actions logs and may include runner-temporary
paths. It never transfers an executable, app bundle, archive, build directory,
full diagnostic record, or signing material between jobs. Its machine-readable
policy fixes `same_runner=true`, `clean_machine=false`,
`platform_trust=false`, `publication_eligible=false`, and
`retention_scope=workflow-owned-candidate-paths-only`, with those scoped paths
verified absent before evidence is recorded. It does not claim that no copy
could exist elsewhere on the runner. The JSON is not authenticated publication
evidence, the checked pull request can change the lane and its validators, and a same-runner lifecycle is not a transported clean-machine
install. Passing this lane cannot satisfy signing, candidate transport,
reputation, independent-review, or publication gates.

The standalone trust contract is distinct from the portable-directory release mode. Its embedded portable payload remains an internal unsigned RC whose files are digest-bound into the SEA build. Authenticode, Sigstore, or Developer ID then authenticates each complete final launcher or app bundle after injection. Those signatures do not authenticate the outer ZIP, receipt, index, or manifest; exact package integrity remains unestablished until a reviewed transport binds the ZIP digest. Launcher trust also does not claim to satisfy the separate Ed25519 requirement for publishing a portable directory.

The intended public onboarding channel is a signed GitHub Release from the
canonical repository, not an unsigned Actions artifact, a draft release, or an
unverified package-registry shim. Once publication is separately approved, the
release page and Studio onboarding must expose the exact tag, commit, platform
asset, SHA-256 digest, signature-verification instructions, compatibility
statement, support route, and rollback/revocation status. The hosted Studio
remains static; launching the verified download opens the paired loopback
Studio.

The DuskDS toolchain remains a separate developer prerequisite. Both the
companion and native production smoke load `config/duskds-toolchain-policy.json`.
The companion never installs or updates Dusk Forge: it verifies Cargo's install
receipt against the full reviewed revision before scaffolding and returns only
the bounded package, version, repository, and revision in its scaffold receipt.

## Publication gates

A public binary release requires all of the following for the exact final hashes:

1. A clean tagged commit and passing source, secret, dependency, unit, build, browser, and platform gates.
2. Valid Windows publisher identity and timestamp, Linux Sigstore bundle and transparency evidence, and Apple Developer ID/notarization/stapling evidence.
3. A separately reviewed private candidate transport that prevents public access and binds every transfer to the exact candidate digest. GitHub Actions artifacts and draft releases are not approved candidate transports.
4. Fresh-machine installation and exact-package lifecycle evidence for both launchers: one-time bootstrap, authenticated session and release parity, safe-mode action denial, Local Actions preflight, exact Studio-owned loopback listeners before and after preflight, closed Studio ports after shutdown, isolated user-data roots, extraction cleanup, install rollback, quarantine, and reputation checks.
5. Independent companion security review and resolution of every release-blocking finding.
6. OS-level containment of deliberately detached tool descendants, or revalidation of the [accepted same-user tool boundary](../security/same-user-tool-boundary-decision.md) and its compensating controls during the independent candidate-specific security review.
7. Documented support owner, incident route, rollback procedure, and compatibility statement.
8. Explicit maintainer approval to change `publication_enabled` and a separately reviewed publication workflow.

Until those gates pass, GitHub source is the only public distribution. A source
checkout supports review and docs-only local development; it does not turn the
hosted Studio into a machine-action client. No unsigned executable should be
promoted as a trusted download.
