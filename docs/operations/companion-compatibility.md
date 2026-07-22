# Local Studio compatibility

## Runtime requirement

The local Studio requires Node.js `>=24.18.0 <25`.

```bash
node --version
```

The npm package is self-contained, installs no additional runtime dependencies, and does not use install lifecycle scripts.

## Supported platforms

| Platform | Local Studio | DuskDS note |
| --- | --- | --- |
| Windows x64 | Safe and Local Actions | Use the platform-specific commands shown by the Studio. The reviewed DuskDS VM-test lane uses Linux; follow the Studio's WSL guidance when that check is required. |
| Linux x64 | Safe and Local Actions | Ubuntu is the primary DuskDS build and VM-test environment. |
| macOS arm64 | Safe and Local Actions | The local runtime and bounded Local Actions surface are supported. Studio does not accept a native macOS DuskDS VM-test pass; use a separately managed Linux environment for that test. |

Use a current browser supported by its vendor. The Studio attempts to open the default browser and can also be opened manually at `http://127.0.0.1:5173`.

## Commands

Safe mode:

```bash
npx dusk-developer-studio@1.0.8
```

Local Actions:

```bash
npx dusk-developer-studio@1.0.8 local-actions
```

Direct DuskDS starter creation:

```bash
npx --yes dusk-developer-studio@1.0.8 create-duskds my-counter
```

The direct command creates one new child of the current working directory.
Local Actions instead writes only beneath its configured managed DuskDS project
root.

## Common runtime behavior

- The Studio runs in the foreground.
- The Studio binds to `127.0.0.1:5173`.
- The companion binds to `127.0.0.1:8788`.
- Port collisions fail with an explanation; the Studio does not silently select another port.
- Administrator or root launches are rejected. Run under one normal developer account.
- Safe mode does not run developer tools or create projects.
- Local Actions checks installed tools and creates projects only through reviewed routes.
- Stopping the command invalidates the local session and closes both Studio-owned ports.
- User projects remain outside the npm cache.

## Developer tools

Local Actions can check tools such as Foundry, Rust, Dusk Forge, WSL, and related utilities when the selected journey needs them.

The Studio:

- does not install or update those tools;
- reports required versus optional tools separately;
- links to relevant installation guidance;
- creates DuskDS starters from the reviewed template contained in the npm package;
- checks the reviewed Dusk Forge Cargo receipt and source revision before its check, build, test, and verification commands are used; and
- does not accept a different tool earlier on `PATH` as proof of the reviewed Forge installation.

An invoked developer tool runs with your user account's authority. Use only tools and versions you trust.

The DuskDS VM-test contract is narrower than npm runtime support:

- Linux runs the reviewed test natively.
- Windows runs it inside Ubuntu 24.04 on WSL after the Linux-side tool checks pass.
- macOS can run the Studio, but the current Studio does not provide or validate a macOS-to-Linux VM/container handoff and therefore does not record native macOS VM-test evidence.

## Project locations

- Windows: `%LOCALAPPDATA%\Dusk\DeveloperStudio\projects`
- macOS: `~/Library/Application Support/Dusk/DeveloperStudio/projects`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/dusk/developer-studio/projects`

See [Local Studio recovery](local-companion-recovery.md) when startup, pairing, tools, or shutdown does not behave as expected.
