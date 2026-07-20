# DuskDS counter starter

This is a minimal DuskDS counter contract with contract WASM, data-driver WASM,
and DuskVM integration-test targets.

The example starter is not audited and is not production-ready. Review and test
the contract for your own use case before deploying it.

## Requirements

- Rust 1.94.0 with the pinned components and WASM target in
  `rust-toolchain.toml`
- `make`
- `wasm-opt` from Binaryen (optional, for smaller artifacts)

## Build and test

```bash
make wasm
make wasm-dd
make test
```

The contract artifact is written to:

```text
target/contract/wasm32-unknown-unknown/release/<project_name>.wasm
```

The data-driver artifact is written to:

```text
target/data-driver/wasm32-unknown-unknown/release/<project_name>.wasm
```

`Cargo.lock` is committed so the reviewed dependency resolution is reproducible.
Use `cargo +1.94.0 update` deliberately when you choose to review and adopt new
dependency versions.

## Origin and license

This starter is a modified derivative of the Dusk Forge counter template.
See `PROVENANCE.md` for the exact source revision and modifications.
The template source is distributed under MPL-2.0; see
`LICENSE-MPL-2.0.txt`.
