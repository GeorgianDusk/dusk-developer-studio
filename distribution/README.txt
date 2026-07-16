Dusk Developer Studio Local

This portable release runs the Studio and its companion on your own machine.
It must remain bound to loopback. It does not request or store wallet secrets.

Safe mode (no tool checks or starter creation):
- Windows: run bin\\dusk-studio.cmd
- Linux/WSL: run bin/dusk-studio

Local-actions mode (tool checks and starter creation enabled):
- Windows: run bin\\dusk-studio-local-actions.cmd
- Linux/WSL: run bin/dusk-studio-local-actions

The launcher uses the Node.js runtime shipped inside this release. External
Node.js and pnpm installations are not required to start the product. Builder
toolchains such as Foundry, Rust, and Dusk Forge remain separate prerequisites
and are checked locally before their related capability is used.

Verify payload-manifest.json and SHA256SUMS before first use. An unsigned-rc
release is for internal testing only and must not be published as an approved
Dusk download.
