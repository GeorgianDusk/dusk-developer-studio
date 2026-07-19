# Threat model

## Scope

Dusk Developer Studio has two trust boundaries:

- the static Hosted guide at `studio.134-122-59-217.nip.io`; and
- the functional local Studio started from the `dusk-developer-studio` npm package.

The Hosted guide provides path selection, education, public read-only checks, resources, and troubleshooting. It does not connect to the developer's machine.

The local Studio runs on the developer's machine with Node.js `>=24.18.0 <25`, opens a paired browser session, and can perform allowlisted checks or starter creation only when Local Actions was explicitly selected.

DuskDS is the active development journey. DuskEVM remains an educational pre-launch journey until its Testnet endpoints and behavior can be verified.

## Assets to protect

- Private keys, mnemonics, seed phrases, seeders, profile entropy, wallet passwords, API secrets, credentials, cookies, and pairing material.
- The user filesystem outside the approved project destination.
- Existing user projects.
- Wallet approval, funding, signing, nonce, fee, submission, and finality decisions.
- Local diagnostics that may contain user paths, addresses, or tool output.
- Dusk-specific source, network, maturity, and product-status claims.
- The public web host, which must not become a command-execution surface.
- npm package identity, integrity, provenance, and repository ownership.

## Trust boundaries

### Hosted guide

The web host serves only static files. It has no companion route, reverse proxy, local token, or machine-action capability.

### npm registry and package

Users trust the exact `dusk-developer-studio` package, its GeorgianDusk repository metadata, strict file inventory, integrity, provenance, Node range, and lack of dependencies and install lifecycle scripts.

### Local browser bootstrap

The local Studio and companion communicate only through fixed IPv4 loopback ports. A one-time in-memory pairing value establishes an origin-bound session.

### Local Actions

The companion accepts a small reviewed set of commands and filesystem operations. External developer tools run with the user's account authority.

### Wallet and network

Wallet secrets and funded actions remain outside the Studio. Public network data is untrusted input and must be validated, source-labelled, and treated according to the selected network.

## Primary risks

1. The UI requests or leaks wallet secrets.
2. The companion runs an arbitrary command or writes outside an approved project root.
3. A local service is exposed through a public interface, tunnel, proxy, or VPS.
4. A malicious browser origin or DNS-rebinding request reaches the companion.
5. An unauthenticated request triggers body parsing, process work, or filesystem changes.
6. Request floods exhaust CPU, memory, subprocess, output, or filesystem capacity.
7. A package-name, owner, registry, dependency, script, file, integrity, or provenance substitution compromises local execution.
8. Frontend and companion versions do not match.
9. A malicious or compromised developer tool abuses the user's authority or leaves a detached process.
10. A path race, symlink, junction, or reparse point redirects project creation or cleanup.
11. RPC or network metadata tricks a user into the wrong network or a false readiness state.
12. Mainnet behavior is mistaken for Testnet guidance.
13. Remote or stale content causes cross-site scripting or incorrect Dusk guidance.
14. Example contracts are mistaken for audited production code.
15. Diagnostics expose secrets, personal paths, or funded-account data.
16. DuskEVM pre-launch material is mistaken for live Testnet capability.

## Controls

### Hosted guide controls

- Serve only static assets.
- Do not include a companion route or loopback client.
- Use CSP, frame denial, MIME-sniffing protection, restrictive permissions, `/healthz`, and deliberate cache boundaries.
- Curate resources as local validated data; do not render remote Markdown or MDX.
- Label network, source, maturity, and freshness.
- Keep DuskEVM live checks unavailable until real Testnet verification.

### Package controls

- Use the exact package name `dusk-developer-studio`.
- Require Node.js `>=24.18.0 <25`.
- Keep the package free of additional install-time runtime dependencies.
- Define no install lifecycle scripts.
- Publish through the canonical GeorgianDusk repository workflow.
- Use a strict file allowlist and include `LICENSE` and `NOTICE`.
- Record package integrity and provenance.
- Test the exact packed bytes before publication.
- Run clean Safe and Local Actions lifecycles on every supported platform.

### Local service controls

- Bind only to `127.0.0.1:5173` and `127.0.0.1:8788`.
- Reject administrator, root, mismatched POSIX identities, and active Linux process capabilities.
- Use fixed ports and fail closed on collision.
- Generate pairing material from at least 32 random bytes and keep it in memory.
- Accept bootstrap and session requests only from exact loopback Host and Origin values.
- Use an origin-bound `HttpOnly`, `SameSite=Strict` session.
- Authenticate before request-body parsing.
- Validate CORS and Private Network Access explicitly.
- Require exact frontend and companion package identity.

### Capability controls

- Safe mode is the default and cannot escalate through a request or hidden flag.
- Local Actions requires an explicit startup argument.
- Validate every request against an exact schema.
- Use exact command and argument allowlists.
- Bound request size, time, output, rate, concurrency, filesystem files, bytes, and depth.
- Give child tools a minimal environment without secret-shaped values.
- Terminate the tracked child or ordinary process group on timeout, overflow, error, and shutdown.
- Never install or update developer tools.
- Verify Dusk Forge through its Cargo receipt and reviewed source revision.

### Filesystem controls

- Constrain projects to a platform user-data root outside the npm cache.
- Normalize project names and reject traversal, device, UNC, drive-relative, and other unsafe forms.
- Reject symlink, junction, and reparse components.
- Populate one private sibling stage under resource bounds.
- Revalidate parent identity and target absence before one atomic promotion.
- Never merge into or overwrite an existing project.
- Remove temporary data only while the approved parent identity remains trusted.

### Wallet and network controls

- Define no private-key or seed fields.
- Do not read, unlock, or sign through a wallet.
- Keep funded deployment and calls in the developer's trusted terminal.
- Keep mainnet reference-only.
- Validate and source-label network metadata.
- Separate readiness, submission, inclusion, finality, metadata, and data-driver availability.
- Label example templates as unaudited and not production-ready.

## Same-user developer-tool limitation

Local Actions invokes installed developer tools with the developer's user authority. A hostile tool can use that authority for filesystem, network, and process effects and may deliberately detach a process outside the Studio's tracked process group.

The Studio reduces exposure through Safe mode by default, explicit Local Actions startup, exact command and argument shapes, reviewed tool identity where available, a minimal environment, bounded effects, normal-user execution, and tracked shutdown.

These controls do not provide operating-system containment and cannot make an untrusted tool safe. Developers must install tools themselves, review their origin and version, and stop or remove unexpected detached processes using platform tools.

## Assumptions

- The operating system, Node.js installation, npm client, browser, and developer account are not already compromised.
- The user obtains `dusk-developer-studio` from the public npm registry and verifies its canonical repository metadata.
- The user runs the Studio as a normal account without a public tunnel or proxy.
- Tools used by Local Actions are intentionally installed and trusted by the developer.
- The Hosted guide and local Studio remain separate origins.

## Security expectations

No release or deployment should proceed with an unresolved critical vulnerability, secret exposure, package-identity mismatch, public companion listener, arbitrary execution path, wallet-secret path, or broken Safe versus Local Actions boundary.

Changes to package identity, install behavior, local commands, filesystem scope, wallet boundaries, public hosting, or network activation require focused security review and the relevant checks in [security-test-matrix.md](security-test-matrix.md).
