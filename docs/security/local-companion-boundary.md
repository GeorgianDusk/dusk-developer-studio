# Local companion security boundary

## Product boundary

The Hosted guide is a static website. It never calls loopback services, enables machine actions, or serves a pairing bootstrap.

The functional local Studio is started through the self-contained `dusk-developer-studio` npm package with Node.js `>=24.18.0 <25`. The package installs no additional runtime dependencies:

```bash
npx dusk-developer-studio
npx dusk-developer-studio local-actions
```

The foreground process serves:

- the Studio on `127.0.0.1:5173`; and
- the companion on `127.0.0.1:8788`.

It installs no service, scheduled task, registry entry, or daemon. It requires one normal developer identity and rejects administrator or root execution before opening listeners, creating project directories, or invoking tools.

## Package boundary

The npm package must:

- use the exact name `dusk-developer-studio`;
- declare Node.js `>=24.18.0 <25`;
- contain no runtime dependencies;
- contain no install lifecycle scripts;
- expose Safe mode as the default command;
- expose Local Actions only through the explicit `local-actions` argument;
- use a strict package file allowlist;
- include the Apache-2.0 `LICENSE` and `NOTICE`;
- identify the canonical GeorgianDusk repository, issues, and homepage;
- record package integrity and provenance; and
- publish the exact package bytes that passed the package and platform checks.

An unexpected owner, repository, dependency, script, file, integrity value, or provenance record is a package incident.

## Startup and identity gates

- Verify the package-defined Studio assets and runtime identity before binding either port.
- Refuse an unsupported Node.js version, operating system, or architecture.
- Use fixed ports and fail closed on a collision.
- Reject elevated Windows and privileged Linux or macOS launches.
- On POSIX systems, require matching real and effective user and group identities and no active Linux process capabilities.
- Generate at least 32 random pairing bytes in memory.
- Never place pairing material in a file, environment variable, command argument, URL, fragment, clipboard, response, or log.
- Require exact frontend and companion package identity before enabling local actions in the UI.

## Browser bootstrap

The local static server exposes a one-time `POST /__dusk/bootstrap` route for five minutes.

It accepts only:

- the exact loopback Host and Origin;
- `application/json`;
- a bounded empty object body; and
- a same-site request.

The server sends the in-memory pairing value directly to the companion and returns only the origin-bound, `HttpOnly`, `SameSite=Strict` session cookie to the browser. A successful bootstrap is consumed and cannot be replayed.

Static responses use no-store caching, a local-only Content Security Policy, frame denial, no-referrer behavior, a restrictive permissions policy, MIME-sniffing protection, and same-origin isolation headers.

Unsafe decoded paths, traversal, dotfiles, backslashes, symbolic links, and reparse entries are rejected.

## Capability gates

### Safe mode

`npx dusk-developer-studio` permits startup, pairing, identity parity, health, guidance, and evidence viewing. It does not enable tool execution or starter creation.

Safe mode cannot be escalated by a hidden flag or request field.

### Local Actions

`npx dusk-developer-studio local-actions` enables only the reviewed prerequisite and starter-creation routes.

- Health, preflight, and scaffold routes require an origin-bound session before body parsing.
- The companion accepts only exact `127.0.0.1` or `localhost` origins for the fixed Studio port.
- Pairing, session, request body, timeout, output, rate, concurrency, file-count, byte, and directory-depth limits are enforced.
- Child tools receive an allowlisted environment.
- Dusk Studio variables and secret-shaped GitHub, cloud, wallet, API, credential, cookie, password, private-key, seed, and token values are not inherited.
- External tools use exact allowlisted commands and arguments with bounded asynchronous output and time.
- No user-controlled shell text or arbitrary command surface is exposed.

## Dusk Forge boundary

DuskDS preflight reads Cargo's `.crates2.json` install receipt from:

1. `CARGO_INSTALL_ROOT`, when set;
2. `CARGO_HOME`; or
3. the standard user Cargo home.

It returns only normalized package, version, repository, and full source revision information.

The check fails when the receipt is absent, malformed, or does not match the reviewed Forge revision. Forge checks and scaffolding use the tool from that same Cargo install root instead of accepting another copy earlier on `PATH`.

The Studio never installs or updates Dusk Forge.

## Filesystem gates

Projects live outside the npm cache:

- Windows: `%LOCALAPPDATA%\Dusk\DeveloperStudio\projects`
- macOS: `~/Library/Application Support/Dusk/DeveloperStudio/projects`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/dusk/developer-studio/projects`

Before scaffolding, the companion:

- normalizes the requested project name;
- constrains it beneath the approved project root;
- rejects lexical escapes, symbolic links, junctions, and reparse components;
- rejects existing targets;
- creates one private sibling stage;
- enforces file, byte, depth, time, and output bounds;
- revalidates parent identity and target absence; and
- promotes the complete project through one atomic rename.

Existing projects are never merged or overwritten. Failed staging data is removed only while the approved parent path and identity remain trusted.

## Process boundary

The Studio terminates the tracked direct child or ordinary process group on timeout, output overflow, failed capability, or supervisor shutdown. Both Studio-owned ports must close when the foreground process exits.

An invoked developer tool runs with the developer's user authority. That tool can exercise the same filesystem, network, and process permissions as the user and may deliberately create a fully detached process outside the Studio's tracked process group.

The Studio reduces this risk through:

- Safe mode by default;
- explicit Local Actions startup;
- a small command and argument allowlist;
- exact reviewed tool identity where available;
- a minimal secret-free child environment;
- bounded output, time, concurrency, and filesystem effects;
- no administrator or root execution; and
- clear shutdown and incident guidance.

These controls do not make an untrusted developer tool safe and do not provide operating-system containment. Use only tools and versions you trust. If a tool behaves unexpectedly, stop the Studio, identify the exact process and listener, and follow the [package quarantine and withdrawal procedure](../operations/companion-quarantine-and-withdrawal.md).

## Verification expectations

Package and cross-platform checks must cover:

- package metadata, strict inventory, integrity, provenance, and absence of install scripts and dependencies;
- Safe and Local Actions command separation;
- fixed-port startup, pairing, identity parity, and session expiry;
- origin, Host, CORS, Private Network Access, body, rate, and concurrency rejection;
- allowlisted tool and filesystem behavior;
- secret-free child environments;
- tracked process shutdown and fixed-port closure;
- project preservation across restart and package update; and
- clean execution on every supported platform.

See the [security test matrix](security-test-matrix.md) and [threat model](threat-model.md).
