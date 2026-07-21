# Dusk Developer Studio

Dusk Developer Studio runs a local developer guide and its allowlisted tooling
companion on your machine. It opens the Studio at
`http://127.0.0.1:5173` and keeps the companion on
`http://127.0.0.1:8788`.

## Requirements

- [Node.js 24.18.0 or newer in the Node 24 LTS release line](https://nodejs.org/en/download/archive/v24.18.0)
- npm
- Windows x64, Linux x64, or Apple Silicon macOS

The npm runtime is supported on all three platforms. DuskDS VM testing is
validated natively on Linux and through Ubuntu 24.04 WSL on Windows; Studio
does not record a native macOS DuskDS VM-test pass.

Builder toolchains such as Foundry, Rust, and Dusk Forge remain separate
developer prerequisites. Studio checks them when the related action is used; it
does not silently install or update them.

## Run Safe mode

```bash
npx dusk-developer-studio@1.0.5
```

Safe mode opens the local Studio with machine actions disabled. It can serve the
guide, establish the private loopback session, and show public read-only
information.

## Run Local Actions

```bash
npx dusk-developer-studio@1.0.5 local-actions
```

Local Actions enables only the reviewed tool checks and starter creation
operations exposed by Studio. It does not request wallet secrets, sign
transactions, dispense funds, deploy to mainnet, or execute arbitrary commands.

Each launch pairs one browser profile. To choose a specific browser or profile,
add `--no-open` to either command, then open
`http://127.0.0.1:5173/#companion` in that profile within five minutes before
opening any other Local Studio page.

## Create a DuskDS starter from the terminal

```bash
npx --yes dusk-developer-studio@1.0.5 create-duskds my-counter
```

This renders the reviewed DuskDS counter template shipped in the package as one
new child of your current working directory. It refuses an existing target and preserves the
pinned Rust toolchain, dependency lock, MPL-2.0 license text, and provenance
record. Install the separately reviewed Dusk Forge prerequisite before running
the generated project's check, build, test, or verification commands.

## Stop Studio

Keep the command running while you use the local browser tab. Press `Ctrl+C` in
the same terminal to stop both loopback services. Projects remain in your user
data folder. On Windows, if `npx` asks `Terminate batch job (Y/N)?`, type `Y`
and press Enter.

## Troubleshooting

- If port 5173 or 8788 is already in use, stop the conflicting local process and
  run Studio again. Studio does not silently select a different port.
- If the browser does not open, leave the command running and open
  `http://127.0.0.1:5173/#companion` yourself within five minutes. If another
  profile already paired, stop the command and rerun it with `--no-open`.
- If a tool check fails, follow its specific install or version guidance and
  retry. Studio does not modify the toolchain for you.
- Run the command as your normal user. Studio refuses administrator and root
  execution.
- If PowerShell reports that script execution is disabled, run `npx.cmd
  dusk-developer-studio@1.0.5` (or add `local-actions`) instead. You do not need to
  weaken your PowerShell execution policy.

For product problems, use the
[GitHub issue tracker](https://github.com/GeorgianDusk/dusk-developer-studio/issues).
Report security issues through
[GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new).
