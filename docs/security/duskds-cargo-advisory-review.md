# DuskDS Cargo advisory review

The packaged DuskDS starter is bound to an exact Cargo lockfile. Production
assurance installs the pinned `cargo-audit` scanner, fetches the current RustSec
database, rejects every reported vulnerability, and exact-matches all
informational warnings against
[`config/cargo-advisory-review.json`](../../config/cargo-advisory-review.json).

The tracked review is deliberately not a blanket ignore list. CI fails when:

- RustSec reports any vulnerability;
- a warning is added, removed, reclassified, or changes package or version;
- the lockfile or dependency count changes;
- the scanner identity, database metadata, or scan output is incomplete;
- an advisory is silently ignored; or
- a warning review is missing an owner or rationale, is future-dated, or
  expires.

## Current reviewed warnings

The current lock has no RustSec vulnerability entries. Five informational
warnings are accepted only through the expiry recorded in the policy:

| Advisory | Package | Kind | Reviewed reachability |
| --- | --- | --- | --- |
| `RUSTSEC-2025-0056` | `adler 1.0.2` | Unmaintained | Native dependency through Dusk Plonk; absent from the exact contract and data-driver WASM build trees. |
| `RUSTSEC-2025-0141` | `bincode 1.3.3` | Unmaintained | Dev/native-test dependency through Dusk VM and Piecrust; absent from the exact WASM build trees. |
| `RUSTSEC-2024-0388` | `derivative 2.2.0` | Unmaintained | Native dependency through arkworks and Dusk Core; absent from the exact WASM build trees. |
| `RUSTSEC-2024-0436` | `paste 1.0.15` | Unmaintained | Native dependency through arkworks and the Dusk VM test stack; absent from the exact WASM build trees. |
| `RUSTSEC-2026-0186` | `memmap2 0.7.1` | Unsound API | Dev/native-test dependency through Piecrust. The affected range-advice and range-flush methods are not called by Piecrust 0.30.0. |

Compatible lock-only updates cannot resolve these warnings. Their parents pin
older dependency lines, and several unmaintained crates have no patched release.
The `memmap2` fix begins at 0.9.11 while Piecrust 0.30.0 requires 0.7. Removal
therefore depends on upstream Dusk, Piecrust, arkworks, or Dusk Plonk changes.

The repository checks weekly and on every production-assurance run. The review
must be renewed with fresh reachability and upstream analysis, or the dependency
tree must be updated, before its recorded expiry.
