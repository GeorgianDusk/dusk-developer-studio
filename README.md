# Dusk Developer Studio

Dusk Developer Studio helps developers choose and follow the right Dusk builder path:

- **DuskEVM** for Solidity and familiar EVM tooling; or
- **DuskDS** for native Rust, WASM, DuskVM, and data-driver development.

Use the [Hosted guide](https://studio.134-122-59-217.nip.io) to explore both paths in the browser. Run the Studio locally when you want environment checks, project scaffolding, and locally recorded evidence.

## Start the local Studio

### Requirement

Install [Node.js 24 LTS](https://nodejs.org/en/download/archive/v24.18.0) at version `>=24.18.0 <25`, then confirm it:

```bash
node --version
```

The local Studio supports Windows x64, Linux x64, and Apple Silicon macOS. The Hosted guide remains available from any modern browser. DuskDS VM testing is validated natively on Linux and through Ubuntu 24.04 WSL on Windows; the current Studio does not record a native macOS DuskDS VM-test pass.

The package is self-contained, installs no additional runtime dependencies, and does not require a global installation.

### Safe mode

```bash
npx dusk-developer-studio@1.0.2
```

Safe mode starts the local Studio, pairs the browser, and provides the guided experience without running developer tools or creating projects.

### Local Actions

```bash
npx dusk-developer-studio@1.0.2 local-actions
```

Local Actions adds allowlisted prerequisite checks and constrained starter creation. It uses developer tools already installed on your machine; it does not install or update them.

The browser opens automatically and each launch pairs one browser profile. To choose a specific browser or profile, add `--no-open` to either command, then open `http://127.0.0.1:5173/#companion` in that profile within five minutes before opening any other Local Studio page.

To create a DuskDS counter starter directly from the same reviewed package template:

```bash
npx --yes dusk-developer-studio@1.0.2 create-duskds my-counter
```

The command writes one new child of your current working directory, refuses an existing target, and preserves the packaged Rust `1.94.0` toolchain, dependency lock, and template provenance. Dusk Forge remains a separate prerequisite for the subsequent check, build, test, and verification commands. Local Actions uses the separate managed DuskDS project root described below.

Both commands open `http://127.0.0.1:5173`. Keep the terminal open while using the Studio and press `Ctrl+C` to stop it. On Windows, if `npx` asks `Terminate batch job (Y/N)?`, type `Y` and press Enter; both loopback services then close.

## Hosted guide or local Studio?

| Surface | Best for | Machine access |
| --- | --- | --- |
| [Hosted guide](https://studio.134-122-59-217.nip.io) | Choosing a path, reading the journey, public read-only network checks, resources, and troubleshooting | None |
| Local Studio in Safe mode | A paired local session and guided workflow without tool execution | Health and session only |
| Local Studio with Local Actions | Prerequisite checks and constrained starter creation | Explicit allowlisted actions |

The Hosted guide never attempts to connect to localhost. Local actions are available only from the loopback Studio opened by the npm command.

## What the Studio provides

- A clear first-screen choice between DuskEVM and DuskDS.
- A complete Setup -> Access -> Build -> Inspect evidence journey for DuskDS, plus one clearly bounded DuskEVM pre-launch learning surface until Testnet activation.
- Source-labelled capabilities, network details, resources, and troubleshooting.
- Beginner-friendly explanations alongside exact commands and evidence.
- A DuskDS workflow covering public-node access, W3sper, Dusk Forge, starter creation, build checks, manual Testnet deployment readiness, and post-deploy inspection.
- A DuskEVM educational journey covering architecture, Foundry workflow, safety boundaries, and expected developer flow.

### DuskEVM availability

DuskEVM Testnet is not live yet. The DuskEVM path is therefore an educational pre-launch guide: it does not claim live RPC, wallet, balance, deployment, or inspection evidence. The guide will activate those checks only after the real Testnet endpoints and behavior can be verified.

The [DuskEVM Testnet activation checklist](docs/quality/duskevm-testnet-activation-checklist.md) defines the network, wallet, build, security, accessibility, monitoring, exact-candidate, and rollback evidence required before that boundary changes.

### DuskDS deployment boundary

The Studio can verify prerequisites, build evidence, and command shape. Rusk Wallet settings, funding, wallet signing, nonces, optional arguments, gas choices, submission, inclusion, and finality remain in your trusted terminal.

Inspect is a two-pass flow:

1. verify the exact build and prepare the manual Testnet deployment handoff;
2. deploy through Rusk Wallet in your terminal; then
3. return after finality to confirm contract metadata and read-only data-driver behavior.

## Local files and developer tools

Projects created through Local Actions are stored outside the npm cache:

- Windows: `%LOCALAPPDATA%\Dusk\DeveloperStudio\projects`
- macOS: `~/Library/Application Support/Dusk/DeveloperStudio/projects`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/dusk/developer-studio/projects`

DuskDS starters use the `duskds` child folder. After creation, Build shows the exact path and uses it for commands while that page remains active. The path stays in page memory and is not saved to browser storage or journey evidence. After a refresh, re-enter the project as an existing repository or retry the same request while the original companion is still running. To choose another contained DuskDS root, set `DUSK_STUDIO_DUSKDS_PROJECT_ROOT` to a normal absolute local folder before starting Local Actions.

Stopping or updating the Studio does not remove these projects.

Local Actions checks existing tools such as Foundry, Rust, Dusk Forge, WSL, or related utilities only when the selected path needs them. DuskDS starter creation uses the reviewed template shipped in the exact npm package rather than downloading a moving upstream template. Follow the Studio's link to the relevant official installation instructions when a tool is missing.

## Security model

The local Studio runs in the foreground and binds only to:

- `127.0.0.1:5173` for the Studio; and
- `127.0.0.1:8788` for the companion.

It installs no service, scheduled task, registry entry, or background daemon. Pairing material stays in memory, sessions are origin-bound and short-lived, local commands are allowlisted, and child process time, output, environment, and filesystem access are bounded.

The Studio never asks for, stores, transmits, or logs private keys, mnemonics, seed phrases, wallet passwords, seeders, profile entropy, or API secrets. It does not sign browser transactions, dispense faucet funds, automate deployment, or execute arbitrary commands.

Local Actions invokes developer tools with your user account's authority. Only use tools and versions you trust. See [SECURITY.md](SECURITY.md), the [threat model](docs/security/threat-model.md), and the [local companion boundary](docs/security/local-companion-boundary.md).

## Troubleshooting

- [Compatibility and requirements](docs/operations/companion-compatibility.md)
- [Local Studio recovery](docs/operations/local-companion-recovery.md)
- [Support and incident reporting](docs/operations/companion-support-and-incident.md)
- [Package quarantine and withdrawal](docs/operations/companion-quarantine-and-withdrawal.md)

## Local development

Repository development uses Node.js `>=24.18.0 <25` and pnpm `11.7.0`.

```bash
corepack enable
corepack install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm dev
```

The development server opens at `http://127.0.0.1:5173`.

Run the verification suite before opening a pull request:

```bash
pnpm check:no-secrets
pnpm verify:local
pnpm e2e
pnpm audit --prod --audit-level moderate
```

## Repository map

- `apps/studio` - React/Vite Studio UI.
- `packages/core` - validated Dusk data models and safe command generation.
- `packages/local-agent` - paired loopback companion.
- `packages/local-runtime` - foreground runtime supervisor.
- `packages/templates` - constrained starter templates.
- `data/dusk` - source-labelled Dusk capability and network records.
- `docs/security` - threat model and security boundaries.
- `docs/deployment` - local package and static self-hosting guidance.
- `.github/workflows` - CI, package verification, deployment assurance, and monitoring.

## Contributing, support, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Use [SUPPORT.md](SUPPORT.md) for help and [SECURITY.md](SECURITY.md) for confidential vulnerability reporting.

Code and repository documentation are licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
