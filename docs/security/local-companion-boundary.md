# Local Companion Security Boundary

Date: 2026-07-18
Status: portable payload and standalone-v3 dual-launcher runtime boundary

## Product Boundary

The hosted Studio is always a static docs-only artifact. It never calls loopback services, enables machine actions, or serves the pairing bootstrap. Local actions exist only in a separately compiled portable artifact whose release identity is bound to the companion runtime.

The portable product runs one foreground supervisor on the developer machine.
It serves the Studio on 127.0.0.1:5173 and the companion on 127.0.0.1:8788. It
installs no service, requires no administrator privileges, changes no registry
keys, and stops when the foreground process exits. Elevated Windows and
privileged Linux/macOS execution fail closed before candidate extraction;
POSIX real/effective user or group mismatches and Linux permitted, effective,
or ambient capabilities are also rejected.

## Startup And Identity Gates

- Verify the exact payload file set, byte sizes, SHA-256 values, bundled Node binary digest, target, version, and full commit before binding either port.
- Refuse a target that does not match Windows x64, Linux x64, or macOS arm64.
- Use fixed ports and fail closed on a collision. Never select a new port silently.
- Generate 32 random pairing bytes in memory. Never put the pairing secret in a file, environment variable, command argument, URL, fragment, clipboard, response, or log.
- Build portable Studio assets with the portable artifact channel. A hosted build remains docs-only even on localhost.
- Require exact product, version, full commit, and portable-channel parity before enabling actions in the UI.

## Browser Bootstrap

The local static server exposes a one-time POST /__dusk/bootstrap endpoint for five minutes. It accepts only the exact loopback Host and Origin, application/json, a bounded empty object body, and a non-cross-site fetch. The static server posts the in-memory token internally to the companion and copies only the HttpOnly SameSite=Strict session cookie to the browser. A successful bootstrap is burned and cannot be replayed.

All static responses use no-store, a local-only Content Security Policy, frame denial, no-referrer, restrictive permissions policy, MIME sniffing protection, and same-origin isolation headers. Unsafe decoded paths, traversal, dotfiles, backslashes, symlinks, and reparse entries are rejected.

## Capability Gates

- Safe mode has its own build-time-bound launcher. It permits startup, pairing, release parity, and health only, and refuses `--enable-local-actions` instead of allowing command-line escalation.
- Local-actions mode has a separately named build-time-bound launcher. It enables allowlisted tool checks and starter creation internally; the user does not pass an enablement flag.
- Health, preflight, and scaffold routes require an origin-bound session before body parsing.
- The companion binds only IPv4 loopback and accepts only 127.0.0.1 or localhost origins for the fixed Studio port.
- Pairing, session, capability, body, timeout, output, concurrency, file-count, byte, and directory-depth bounds are enforced.
- Child tools receive an allowlisted environment. Dusk Studio variables and secret-shaped GitHub, cloud, wallet, API, credential, cookie, password, private-key, seed, and token variables are not inherited.
- External tools use exact allowlisted commands and arguments, bounded
  asynchronous output and time, and termination of their tracked direct process
  or ordinary process group on timeout, overflow, or supervisor shutdown.
  Fixed, reviewed shell wrappers are limited to Windows command shims and the
  bounded optional WSL probe; no user-controlled shell text or arbitrary
  command surface is exposed.
- DuskDS preflight reads only Cargo's `.crates2.json` install receipt under the active `CARGO_INSTALL_ROOT`, falling back to `CARGO_HOME` and then the standard user Cargo home. It returns a normalized package/version/revision identity and fails required readiness when the receipt is absent, malformed, or not bound to the reviewed Forge revision. Forge checks and scaffolding invoke the binary from that same install root's `bin` directory rather than accepting a shadowing `PATH` entry. The companion never installs or updates Forge.

## Filesystem Gates

Portable projects live in the current user data directory, outside the extracted release. The Foundry template root is the verified packaged template. The Dusk Forge output root is a trusted supervisor option, not a child environment override.

Before DuskDS scaffolding, the companion revalidates the normalized Cargo install receipt against `config/duskds-toolchain-policy.json`. Scaffolds then populate a private sibling stage, reject lexical escapes and reparse components, revalidate parent identity and target absence, enforce resource bounds, and atomically rename one complete tree. Existing targets are never merged or overwritten.

## Distribution Gates

Every candidate includes an exact payload manifest, SHA256SUMS, CycloneDX SBOM, SLSA-shaped provenance, Node license, third-party notices, deterministic archive, and separate mode-bound Safe and Local Actions launchers. The standalone build receipt records each unsigned launcher's mode, name, byte size, and SHA-256 plus one digest over the ordered two-launcher asset index. After platform signing, one ZIP per OS binds both launchers through a signed-launcher index and an exact allowlisted package manifest; each macOS app must physically include its stapled `Contents/CodeResources` ticket. A dependency-free extractor validates the complete ZIP directory, path and case uniqueness, file types, sizes, compression ratio, CRCs, modes, digests, and manifest before creating files beneath a new install root. Fresh-runner evidence is accepted only when that exact package completes both mode lifecycles and retains the bounded report inside its run-bound target envelope; a command-line claim cannot mark cleanup as passed. Candidate processes receive an isolated working directory and a minimal non-credential environment. Evidence names its scope precisely: Studio-owned listeners are checked before and after preflight, both fixed loopback ports must close after shutdown, and install/extraction rollback covers only runner-owned files. The receipt records that portable payload verification does not establish platform trust for the post-injection executables. The runtime archive and its official SHA-256 are pinned in config/companion-runtime-lock.json.

The separate unsigned engineering lane builds twice and exercises both launchers
on ephemeral native GitHub-hosted runners without moving an executable between
jobs. It proves privileged-launch rejection on Linux and macOS; on the elevated Windows
hosted runner it proves elevated rejection, then runs the exact lifecycle under
a temporary standard local user with an ACL-isolated runner root and removes
that account. It checks every exact workflow-owned candidate path for absence
at cleanup time and uploads no workflow artifacts. Full evidence records and
candidate files remain runner-local; ordinary bounded status output is retained
in GitHub Actions logs and may include runner-temporary paths. The records
explicitly deny platform trust, clean-machine, download-integrity, and
publication claims and are not authenticated release evidence.

Lifecycle-owned install and workspace trees are removed only through the
identity-revalidated lifecycle helper after tracked shutdown is confirmed. If
shutdown cannot be confirmed, the job fails without recursively deleting those
trees and relies on disposal of the ephemeral hosted runner.

An external tool runs with the developer's account authority and can exercise
that authority for filesystem, network, and process effects while active. It
may also deliberately create a fully detached process that escapes Node's
portable child tracking. Lifecycle evidence therefore does not claim OS-level
containment of a hostile same-user tool or machine-wide process cleanup. George
accepts this boundary for the current source-only and internal companion scope
under [the same-user tool boundary decision](same-user-tool-boundary-decision.md),
with the listed compensating controls and revisit triggers. That maintainer
decision is not an independent security review or publication approval.

Unsigned RCs are internal-only. Candidate transport is disabled: signed binaries must not use GitHub Actions artifacts or draft releases, and fresh-runner smoke remains blocked until a separately reviewed private transport binds each transfer to the exact digest. Standalone publication then requires post-injection Authenticode on Windows, tag-bound keyless Sigstore on Linux, and Developer ID signing, hardened runtime, notarization, stapling, and Gatekeeper on macOS, with fresh-runner smoke for every target. Windows and Apple identities are intentionally unconfigured, so public binaries remain disabled. Independent download/quarantine and reputation checks, security acceptance, support ownership, install rollback, and explicit publication approval also remain required. No signing key or generated private key belongs in the repository.
