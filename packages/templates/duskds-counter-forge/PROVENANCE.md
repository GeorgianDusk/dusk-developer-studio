# Template provenance

## Upstream

- Repository: `https://github.com/dusk-network/forge`
- Revision: `d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a`
- Source paths:
  - `contract-template/.gitignore`
  - `contract-template/Cargo.toml`
  - `contract-template/Makefile`
  - `contract-template/src/lib.rs`
  - `contract-template/tests/contract.rs`
  - `rust-toolchain.toml`
- Upstream license declaration: `MPL-2.0` in the Forge package manifests.

The exact Forge revision did not contain a tracked license-text file. This
derivative includes the unmodified Mozilla Public License 2.0 text in
`LICENSE-MPL-2.0.txt`.

## Reviewed dependency resolution

Forge created the counter project and Cargo 1.94.0 generated `Cargo.lock` in an
unprivileged Ubuntu 24.04 WSL2 pilot. Cargo locked 275 dependency packages; the
file contains 276 package records including the root project. The generated lock
was 68,200 bytes and had SHA-256:

```text
6657e6da48dc245860aa8575b0633d88e0cdd7fcedce524789c682d246284ea4
```

The Rusk dependency resolved from tag `dusk-core-1.6.0` at commit:

```text
ae1a38a2079c681126a96f94c17d282ea2639946
```

For the first reusable-template resolution, only the root package name in the
generated lock was normalized from the one-off pilot name to the valid
placeholder `dusk-studio-template-project`. Dependency package records,
versions, sources, and checksums were unchanged at that normalization step. The
normalized baseline had SHA-256:

```text
c1ac706c10edf715eebc33c2b04b430911597ffa8dfb393f41f2535468edd3cb
```

Before the `1.0.1` release, GitHub advisories
`GHSA-7gcf-g7xr-8hxj` and `GHSA-r6v5-fh4h-64xc` prompted a reviewed security
refresh in an isolated unprivileged Ubuntu 24.04 WSL2 copy with Cargo 1.94.0:

```text
cargo +1.94.0 update -p serde_with@3.17.0 --precise 3.21.0
```

That refresh changed `serde_with` from 3.17.0 to 3.21.0, `time` from 0.3.45 to
0.3.53, `time-core` from 0.1.7 to 0.1.9, and `num-conv` from 0.1.0 to 0.2.2.
It added `bs58` 0.5.1 alongside the still-required 0.4.0 record. The current
template lock contains 277 package records including the root project, is
68,426 bytes, and has SHA-256:

```text
1408051342213d41a91342497b18856c87afc3bc0eeb1c750932e634525445da
```

`cargo metadata --locked`, `make test`, and `make wasm-dd` passed against this
exact lock with Rust 1.94.0. The post-build hash remained unchanged. The Forge
revision, Rusk tag and revision, template `Cargo.toml`, source, and licensing
remain unchanged from the reviewed baseline.

## Studio modifications

- Pin the Rust channel to exact version `1.94.0`.
- Correct the Makefile prerequisite from generic nightly Rust to the exact
  pinned Rust 1.94.0 toolchain.
- Use one valid placeholder identity consistently in `Cargo.toml`,
  `Cargo.lock`, the Rust module and struct, and the expected WASM filename.
- Declare `MPL-2.0` and `publish = false` in the generated Cargo package.
- Commit the reviewed, security-refreshed lockfile.
- Run metadata, build, test, lint, expansion, and documentation commands with
  Cargo's `--locked` gate so normal template commands cannot rewrite the
  reviewed dependency resolution.
- Quote Cargo target directories, optimizer inputs, displayed artifact paths,
  and make tests depend on the phony WASM target instead of an unescaped
  absolute file target. Use only fail-closed `cargo clean`, with no manual
  recursive-delete command. These changes keep projects under paths containing
  spaces safe and functional.
- Render the crate name directly into the Makefile and use constant relative
  `target/contract` and `target/data-driver` directories. This removes both the
  upstream `cargo metadata | jq` failure path that could collapse a target
  directory to `/target` and any shell interpolation of a user-controlled
  absolute project path, while also removing `jq` as a starter requirement.
- Rename the source `.gitignore` to `.gitignore.template` in the npm asset so
  npm preserves it; the renderer restores `.gitignore` in created projects.
- Add this provenance record, the MPL-2.0 text, and user-facing safety/build
  guidance.

All modified upstream template source files in this directory remain governed
by MPL-2.0.
