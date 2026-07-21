# Run the local Studio

The local Studio provides a paired browser session, locally recorded evidence, allowlisted prerequisite checks, and constrained starter creation.

## Requirement

Install Node.js `>=24.18.0 <25`:

```bash
node --version
```

The `dusk-developer-studio` package is self-contained, installs no additional runtime dependencies, and requires no global installation.

## Choose a mode

### Safe mode

```bash
npx dusk-developer-studio@1.0.3
```

Safe mode starts the Studio and pairing flow without running developer tools or creating projects.

### Local Actions

```bash
npx dusk-developer-studio@1.0.3 local-actions
```

Local Actions enables the reviewed prerequisite checks and starter-creation routes. It uses developer tools already installed on your machine and never installs or updates them.

The two modes are intentionally separate. Stop the foreground process before changing modes.

## What starts

The command starts:

- the Studio at `http://127.0.0.1:5173`; and
- its companion at `http://127.0.0.1:8788`.

The browser normally opens automatically and each launch pairs one browser profile. If it does not open, keep the terminal running and open `http://127.0.0.1:5173/#companion` yourself within five minutes. To choose a specific browser or profile, add `--no-open` to the Safe mode or Local Actions command, then open that URL in the intended profile before any other Local Studio page. If another profile already paired, stop the command and rerun it with `--no-open`.

Both services bind only to IPv4 loopback. The process installs no service, scheduled task, registry entry, or background daemon. Press `Ctrl+C` to stop it.

## Package identity

Use the exact package name from the public npm registry:

```bash
npm view dusk-developer-studio name version license repository engines dist.integrity
```

The repository field must point to `https://github.com/GeorgianDusk/dusk-developer-studio`.

Do not run copied package files, issue attachments, direct-message downloads, or third-party mirrors. Treat an unexpected repository, owner, dependency, install lifecycle script, file inventory, or integrity value as a security concern.

To reproduce behavior from a specific package version:

```bash
npm exec --ignore-scripts --package=dusk-developer-studio@1.0.3 -- dusk-developer-studio
npm exec --ignore-scripts --package=dusk-developer-studio@1.0.3 -- dusk-developer-studio local-actions
```

Replace `1.0.3` with another reviewed version when needed. Never combine files from different package versions.

## Project preservation

Projects created through Local Actions live outside the npm cache:

- Windows: `%LOCALAPPDATA%\Dusk\DeveloperStudio\projects`
- macOS: `~/Library/Application Support/Dusk/DeveloperStudio/projects`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/dusk/developer-studio/projects`

Stopping, updating, or removing cached package data does not remove these projects.

## Security boundary

The Studio keeps pairing material in memory, validates exact loopback Host and Origin values, requires an origin-bound session before capabilities, and checks exact frontend/runtime identity before enabling local actions.

Child tool commands, arguments, time, output, environment, concurrency, and filesystem scope are bounded. Wallet secrets, browser signing, funded actions, arbitrary commands, and developer-tool installation are outside the product.

Local Actions invokes installed developer tools with your user account's authority. Review the [local companion security boundary](../security/local-companion-boundary.md) before enabling it.

## Help

- [Compatibility](../operations/companion-compatibility.md)
- [Local recovery](../operations/local-companion-recovery.md)
- [Support and incident reporting](../operations/companion-support-and-incident.md)
- [Package quarantine and withdrawal](../operations/companion-quarantine-and-withdrawal.md)
