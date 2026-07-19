# Local Studio recovery

## Start again safely

Safe mode:

```bash
npx dusk-developer-studio
```

Local Actions:

```bash
npx dusk-developer-studio local-actions
```

Keep the terminal open while using the Studio. Press `Ctrl+C` before changing modes or restarting.

## Startup problems

### Unsupported Node.js version

The local Studio requires Node.js `>=24.18.0 <25`.

```bash
node --version
```

Install a compatible Node.js version, open a new terminal, and run the command again.

### Port 5173 or 8788 is already in use

The Studio uses fixed loopback ports and does not silently select alternatives.

Stop the local process that owns the conflicting port, then restart the Studio. Identify the process by listener and command before stopping it; do not kill every Node.js process by name.

### Browser did not open

Leave the foreground command running and open:

```text
http://127.0.0.1:5173
```

Do not place pairing values in the URL.

### Administrator or root launch was rejected

Open a normal, non-elevated terminal under your developer account and run the command again. Do not add a bypass or run Local Actions with elevated privileges.

## Pairing or identity problems

### Session expired or bootstrap was consumed

Stop the foreground process with `Ctrl+C`, then restart it. A new in-memory pairing value and browser session will be created.

### Frontend/runtime identity mismatch

Stop the process. Run one complete package version instead of combining cached or copied files:

```bash
npx dusk-developer-studio@<version>
```

If the mismatch persists, record the package version and `dist.integrity`, then follow the [package quarantine procedure](companion-quarantine-and-withdrawal.md).

### You opened the Hosted guide

The Hosted guide provides browser guidance and public read-only checks but never connects to localhost. Start the npm package and use the browser window opened from that foreground process for local checks and starter creation.

## Local Actions problems

### Safe mode blocked a check or scaffold

That is expected. Stop Safe mode and deliberately start Local Actions:

```bash
npx dusk-developer-studio local-actions
```

### A required tool is missing

Follow the exact preflight category and installation link shown by the Studio. Local Actions does not install or update Foundry, Rust, Dusk Forge, WSL, or related tools.

Restart the Studio after installing or updating a prerequisite so the preflight reads a fresh environment.

### Dusk Forge revision does not match

Follow the reviewed Forge installation command shown by the Studio. The DuskDS check reads Cargo's local install receipt and rejects an absent, malformed, or different source revision.

### The project target already exists

Choose a new project name or move the existing directory yourself. The Studio never merges into or overwrites an existing project.

### Starter creation was interrupted

The final target should remain absent. Stop the Studio before inspecting temporary work. Do not follow or remove a temporary directory beneath a parent whose path or ownership changed unexpectedly.

## Shutdown and projects

Press `Ctrl+C` in the foreground terminal.

Shutdown:

- invalidates in-memory sessions;
- closes ports 5173 and 8788;
- terminates active tracked child processes or their ordinary process group; and
- preserves user projects.

Project locations:

- Windows: `%LOCALAPPDATA%\Dusk\DeveloperStudio\projects`
- macOS: `~/Library/Application Support/Dusk/DeveloperStudio/projects`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/dusk/developer-studio/projects`

An external developer tool invoked by Local Actions runs with your account authority. A deliberately detached process can outlive the Studio's tracked process group. If that occurs, identify the exact tool and process before stopping it; do not terminate unrelated processes by name.

## Suspected package incident

Stop and report an unexpected package owner, repository, dependency, install lifecycle script, integrity value, non-loopback listener, or capability.

Preserve only the safe metadata listed in [Package quarantine and withdrawal](companion-quarantine-and-withdrawal.md). Never include wallet secrets, environment dumps, pairing material, absolute paths, or funded-account data.

Use the [support and incident route](companion-support-and-incident.md) for the report.
