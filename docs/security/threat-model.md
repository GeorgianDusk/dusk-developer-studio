# Threat Model

## Scope

Dusk Developer Studio is an independent open-source project: a static public
Studio plus optional local-companion source for each developer's own machine.
The hosted production scope is DuskDS guidance and read-only public-node
verification. DuskEVM remains an educational pre-launch preview until its
Testnet is live and independently verified. Product, self-hosting, and release
boundaries are documented in `../../README.md` and `../deployment/`.

## Assets To Protect

- Wallet private keys, mnemonics, seeders, profile entropy, wallet passwords, and API secrets.
- User filesystem outside the selected project/template destination.
- Local wallet approval boundaries.
- Local diagnostics that may include wallet addresses or host paths.
- Dusk-specific product status claims.
- The public VPS host, which must not become a command-execution surface.

## Primary Risks

1. UI asks for or stores private keys.
2. Local companion runs arbitrary commands or writes outside allowed paths.
3. Local companion is accidentally exposed on a public interface.
4. Malicious RPC/network metadata tricks users into wrong-chain actions.
5. Remote docs/content injection causes XSS.
6. Mainnet flow is mistaken for a testnet flow.
7. Example contracts are misread as audited or production-ready.
8. Diagnostics leak secrets or personal local paths.
9. Public copy overclaims Hedger, native deployment, faucet, or production status.
10. A malicious browser origin or DNS-rebinding request reaches the loopback companion.
11. An unauthenticated request triggers body parsing, process execution, or filesystem writes.
12. Request floods exhaust local CPU, memory, subprocess, or filesystem capacity.

## Public Hosted Controls

- Public VPS serves only the static Studio.
- Local companion binds to `127.0.0.1` only, validates the exact loopback Host and Origin, and rejects missing origins.
- Hosted origins are never trusted. Pairing is available only from a locally opened Studio.
- A 32+ character startup token creates a short-lived, origin-bound HttpOnly session; the token is never returned or logged.
- Health, preflight, and scaffold routes require the paired session. Authentication happens before request-body parsing.
- Process and filesystem capabilities are disabled in the Safe executable and exist only in the separately named, mode-bound Local Actions executable.
- Request bodies, time, rate, and concurrency are bounded; errors and diagnostics omit workspace paths and raw process output.
- CORS preflight and Private Network Access are validated explicitly. Private Network Access is denied by default.
- Filesystem parents are materialized beneath canonical approved roots, checked for symlinks/junctions/reparse points, and revalidated by real path and directory identity immediately before promotion.
- Scaffolds populate a private sibling stage and become visible only through one atomic rename; existing targets are rejected and failed stages are removed only while their parent identity remains trusted.
- External tool execution uses exact commands, bounded output/time, and termination of tracked direct processes or ordinary process groups; the request server no longer runs blocking `spawnSync` paths.
- Source freshness and tracked-source boundary checks fail the product gate when provenance is stale/unverified or generated/provider/sensitive paths enter the release scope.
- No private key fields anywhere.
- No browser-based transaction signing.
- Mainnet disabled by default.
- Network metadata is schema-validated and source-labeled.
- Template generation uses safe path checks.
- Remote Markdown/MDX rendering is not supported.
- Docs/resources are curated local data.
- Diagnostics are redacted before export.
- Example templates are labeled unaudited and not production-ready.
- Security headers, CSP, `/healthz`, and cache controls are included for static hosting.

The portable supervisor verifies its exact payload before binding, keeps the pairing secret in memory only, bootstraps one same-origin browser session without URLs or environment variables, requires exact frontend/runtime release parity, defaults to safe mode, strips secret-shaped child environments, terminates active tracked children on shutdown, and closes both Studio-owned loopback services.

Release packaging rejects unsafe paths, reparse entries, undeclared files, secret-like material, and absolute build-host paths; binds a pinned Node binary, SBOM, personal-project provenance identifiers, and checksums; and produces deterministic engineering inputs. Every OS candidate is one exact forward-slash ZIP with two distinct mode-bound launchers and a complete allowlisted package manifest. Before extraction, the central directory, local headers, paths, collisions, file types, sizes, compression ratios, CRCs, modes, and manifest are validated under strict bounds. Candidate processes run from isolated directories with a minimal credential-free environment. Lifecycle cleanup is permitted only beneath a pre-existing runner-owned ephemeral root after Studio-owned listener closure and directory-identity and symlink revalidation. Drive roots, parent paths, symlinks, reparse boundaries, unexpected package files, output collisions, and unconfirmed Studio shutdown fail closed before removal.

The lifecycle harness assumes a fresh, isolated hosted runner without a hostile same-account process mutating `RUNNER_TEMP`. Node does not expose a portable handle-relative `openat`/`unlinkat` tree API, and Windows does not expose `O_NOFOLLOW`; an adversary already executing as the runner account could therefore attempt a junction or pathname race between validation and use. Random private siblings, exclusive creation, atomic final rename, filesystem-identity checks, and revalidation make this non-exploitable by a malicious ZIP alone, but they do not replace OS-level account isolation.

The companion invokes already installed developer tools with the developer's own account authority. A hostile or compromised tool can deliberately detach a daemon outside Node's portable child/process-group tracking. Signed-candidate evidence is therefore scoped to Studio-owned loopback shutdown and runner-owned install-file rollback; it never claims machine-wide process cleanup. Public binary publication remains blocked until OS-level detached-descendant containment is implemented or this same-user tool boundary is explicitly accepted with compensating controls.

Unsigned RCs are internal-only. Candidate transport remains disabled, every enabled transport shape is rejected by policy schema 2, and candidate binaries are forbidden from GitHub Actions artifacts and draft releases until a private transport is separately implemented and reviewed. Candidate acceptance is intentionally independent of publication, but it remains bound to the protected tag, full commit, workflow run, attempt, actor, creation window, exact package hashes, launcher indexes, package manifest, retained lifecycle reports, and platform checks. Publication separately requires a digest-bound, time-bounded dossier and an explicit switch. Schema 2 can validate dossier shape but cannot authenticate referenced bytes or actor identities, so it rejects every publication dossier rather than treating URLs, names, or caller-supplied hashes as proof. The standalone channel then requires post-injection maintainer platform trust: Authenticode with timestamp on Windows, tag-bound keyless Sigstore on Linux, and Developer ID with hardened runtime, notarization, stapling, and Gatekeeper on macOS. Separate fresh runners verify scoped Studio lifecycle and install rollback, while independent download/quarantine, reputation, compatibility, detached-descendant boundary acceptance, and security review remain external publication gates. The hosted artifact remains docs-only and never becomes a loopback client.

The precise boundary and configuration contract is documented in local-companion-boundary.md.

## Release Gate

Before claiming any builder path production-ready: approved production origin;
exact release-manifest parity; supported companion distribution or enforced
docs-only mode; Dusk source freshness; dependency and secret gates; browser,
accessibility, and representative developer QA; independent companion security
review; separate platform/Caddy review; approved copy and visible release
identity; assigned support/monitoring owners; rehearsed Studio/platform
rollback; and explicit confirmation that no VPS-exposed companion exists.

No P0 may remain. A P1 is no-go unless George explicitly accepts a time-limited exception containing the owner, rationale, compensating control, residual risk, monitoring, expiry, and revalidation trigger.
