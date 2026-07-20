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

For this reusable template, only the root package name in the generated lock
was normalized from the one-off pilot name to the valid placeholder
`dusk-studio-template-project`. Dependency package records, versions, sources,
and checksums were not regenerated or changed.

## Studio modifications

- Pin the Rust channel to exact version `1.94.0`.
- Correct the Makefile prerequisite from generic nightly Rust to the exact
  pinned Rust 1.94.0 toolchain.
- Use one valid placeholder identity consistently in `Cargo.toml`,
  `Cargo.lock`, the Rust module and struct, and the expected WASM filename.
- Declare `MPL-2.0` and `publish = false` in the generated Cargo package.
- Commit the reviewed lockfile.
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
