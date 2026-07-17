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

DuskDS starter creation requires the reviewed Forge source revision. The Studio
does not install or update Forge for you. After installing Rust with rustup, run
this command yourself if you choose to enable DuskDS local actions:

cargo +1.94.0 install --locked --force --git https://github.com/dusk-network/forge --rev d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a dusk-forge-cli

The DuskDS preflight reads Cargo's local install receipt and rejects an absent or
different Forge revision. A successful scaffold receipt reports the bounded
Forge package, version, repository, and full reviewed revision. Checks and
scaffolding invoke Forge from that same Cargo install root's bin directory
rather than accepting another copy earlier on PATH. If CARGO_INSTALL_ROOT or
CARGO_HOME was customized during installation, start Portable Studio with the
same value so the receipt and binary can be selected consistently.

Verify payload-manifest.json and SHA256SUMS before first use. An unsigned-rc
release is for internal testing only and must not be promoted as a trusted
public download.
