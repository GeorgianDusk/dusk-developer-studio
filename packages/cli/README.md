# Dusk Developer Studio

Dusk Developer Studio runs a local developer guide and its allowlisted tooling
companion on your machine. It opens the Studio at
`http://127.0.0.1:5173` and keeps the companion on
`http://127.0.0.1:8788`.

## Requirements

- [Node.js 24.18.0 or newer in the Node 24 LTS release line](https://nodejs.org/en/download/archive/v24.18.0)
- npm
- Windows x64, Linux x64, or Apple Silicon macOS

Builder toolchains such as Foundry, Rust, and Dusk Forge remain separate
developer prerequisites. Studio checks them when the related action is used; it
does not silently install or update them.

## Run Safe mode

```bash
npx dusk-developer-studio
```

Safe mode opens the local Studio with machine actions disabled. It can serve the
guide, establish the private loopback session, and show public read-only
information.

## Run Local Actions

```bash
npx dusk-developer-studio local-actions
```

Local Actions enables only the reviewed tool checks and starter creation
operations exposed by Studio. It does not request wallet secrets, sign
transactions, dispense funds, deploy to mainnet, or execute arbitrary commands.

## Stop Studio

Keep the command running while you use the local browser tab. Press `Ctrl+C` in
the same terminal to stop both loopback services. Projects remain in your user
data folder.

## Troubleshooting

- If port 5173 or 8788 is already in use, stop the conflicting local process and
  run Studio again. Studio does not silently select a different port.
- If the browser does not open, leave the command running and open
  `http://127.0.0.1:5173` yourself.
- If a tool check fails, follow its specific install or version guidance and
  retry. Studio does not modify the toolchain for you.
- Run the command as your normal user. Studio refuses administrator and root
  execution.
- If PowerShell reports that script execution is disabled, run `npx.cmd
  dusk-developer-studio` (or add `local-actions`) instead. You do not need to
  weaken your PowerShell execution policy.

For product problems, use the
[GitHub issue tracker](https://github.com/GeorgianDusk/dusk-developer-studio/issues).
Report security issues through
[GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new).
