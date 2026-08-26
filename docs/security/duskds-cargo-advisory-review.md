# DuskDS Cargo advisory review

The packaged DuskDS starter is bound to an exact Cargo lockfile. Production
assurance and the reusable npm package assurance both install the pinned
`cargo-audit` scanner, fetch the current RustSec database, reject every
unreviewed vulnerability, and exact-match all informational warnings against
[`config/cargo-advisory-review.json`](../../config/cargo-advisory-review.json).
Because both npm publication workflows consume the reusable assurance as a
required job, an expired or changed Cargo review fails the exact tag before any
package can be published. The same reusable job also runs the live
moderate-or-higher npm advisory gate before packing the candidate.

The latest exact scan ran on 2026-08-26 with `cargo-audit 0.22.2` and RustSec
database commit `a7bfe16948bf6f3ee25bdee4822209f87da21b80`. The 277-dependency
lock still reports the same one reviewed vulnerability and six reviewed
warnings; no advisory identity, package version, or dependency count changed.

When an upstream migration is not yet compatible, the same policy can carry a
short-lived, exact vulnerability review. This is not a blanket ignore: package,
version, advisory, owner, reachability, mitigation, upstream status, and expiry
must all match, and `cargo-audit` still runs without `--ignore`.

The tracked review is deliberately not a blanket ignore list. CI fails when:

- RustSec reports a vulnerability that is not an exact, unexpired reviewed identity;
- a reviewed vulnerability is added, removed, changes package or version, or
  lacks owner, reachability, mitigation, upstream, or expiry evidence;
- a warning is added, removed, reclassified, or changes package or version;
- the lockfile or dependency count changes;
- the scanner identity, database metadata, or scan output is incomplete;
- an advisory is silently ignored; or
- a warning review is missing an owner or rationale, is future-dated, or
  expires.

## Current reviewed vulnerability

The lock currently reports one vulnerability with a temporary review expiring
on 2026-09-05:

| Advisory | Package | Reviewed reachability and mitigation |
| --- | --- | --- |
| `RUSTSEC-2026-0235` | `rkyv 0.7.46` | The affected validation path requires an archived `Rc` or `Arc` with an unsized pointee and conflicting metadata. The exact locked Dusk Core, Dusk VM, Piecrust, and crypto sources contain no such archived field, and the generated template does not call `rkyv` directly. CI exact-matches this identity, expires the review, and rejects all other vulnerabilities. |

The fixed line begins at `rkyv 0.8.17`. Dusk Core and Dusk VM 1.7.0 at checked
rusk commit `311cc64df1018a9960babd19bc2b6d2e7bc3d4f3`, plus Piecrust 0.32.0
at checked commit `3dee64f7c9813c0dbb5f3d5fc26d897d800d10a2`, still use `rkyv 0.7`.
Removal therefore requires a coordinated upstream dependency and archive-format
migration. Any lock change requires a fresh reachability review.

## Current reviewed warnings

Six informational warnings are accepted only through the expiry recorded in
the policy:

| Advisory | Package | Kind | Reviewed reachability |
| --- | --- | --- | --- |
| `RUSTSEC-2025-0056` | `adler 1.0.2` | Unmaintained | Native dependency through Dusk Plonk; absent from the exact contract and data-driver WASM build trees. |
| `RUSTSEC-2025-0141` | `bincode 1.3.3` | Unmaintained | Dev/native-test dependency through Dusk VM and Piecrust; absent from the exact WASM build trees. |
| `RUSTSEC-2024-0388` | `derivative 2.2.0` | Unmaintained | Native dependency through arkworks and Dusk Core; absent from the exact WASM build trees. |
| `RUSTSEC-2024-0436` | `paste 1.0.15` | Unmaintained | Native dependency through arkworks and the Dusk VM test stack; absent from the exact WASM build trees. |
| `RUSTSEC-2026-0186` | `memmap2 0.7.1` | Unsound API | Dev/native-test dependency through Piecrust. The affected range-advice and range-flush methods are not called by Piecrust 0.30.0. |
| `RUSTSEC-2026-0253` | `lru 0.16.4` | Unsound API | Dev/native-test dependency through Dusk VM. Its host-query cache does not call the affected `LruCache::pop()` path, and the trigger additionally requires a panicking key destructor during unwind followed by eviction. |

Compatible lock-only updates cannot resolve these warnings. Their parents pin
older dependency lines, and several unmaintained crates have no patched release.
The `memmap2` fix begins at 0.9.11 while current Piecrust 0.32.0 still requires
0.7. The `lru` fix begins at 0.18.2 while current Dusk VM 1.7.0 still uses the
0.16 line. Removal therefore depends on upstream Dusk, Piecrust, arkworks,
dusk-wasmtime, or Dusk Plonk changes.

The repository checks weekly, on every production-assurance run, and in every
publication-bound reusable package-assurance run. Every review must be renewed
with fresh reachability and upstream analysis, or the dependency tree must be
updated, before its recorded expiry.
