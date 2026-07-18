# Companion compatibility

Date: 2026-07-18

Status: intended targets documented; public companion distribution disabled

## Read this matrix correctly

The table records the implemented target contract and current verification
scope. It is not a download matrix and does not claim that a signed,
clean-machine-tested package exists.

| Target | Intended package | Current verification scope | DuskDS execution note | Missing publication evidence |
| --- | --- | --- | --- | --- |
| Windows x64 | ZIP with separate Safe and Local Actions executables | Ephemeral Windows 2025 same-runner unsigned reproducibility, elevated-launch rejection, one-use limited S4U standard-user exact-package lifecycle, exact-SID task/profile/LSA-right/account teardown, required `NotSigned` Authenticode state, completed Defender scan command, and cleanup diagnostics | The reviewed automated VM-test lane runs on GitHub-hosted Ubuntu 24.04. No native Windows or WSL VM-test evidence is recorded | Authenticode identity and timestamp, reviewed candidate transport, exact-package clean-machine lifecycle, and withdrawal drill |
| Linux x64 | ZIP with separate Safe and Local Actions ELF launchers and Sigstore bundles | Ephemeral Ubuntu 24.04 same-runner unsigned reproducibility, privileged-launch rejection, ELF/NX/mode checks, exact-package lifecycle, and cleanup diagnostics; exact native DuskDS smoke | Native Ubuntu 24.04 is the reviewed DuskDS build and VM-test lane | Final tag-bound signed package, reviewed candidate transport, exact-package clean-machine lifecycle, and withdrawal drill |
| macOS arm64 | ZIP containing separate Safe and Local Actions app bundles | Ephemeral macOS 15 arm64 same-runner unsigned reproducibility, privileged-launch rejection, ad-hoc executable integrity, expected Gatekeeper rejection, exact-package lifecycle, and cleanup diagnostics | Use a Linux VM or container for the reviewed DuskDS VM test; a native macOS VM-test pass is not recorded | Developer ID, hardened runtime, notarization, stapling, Gatekeeper acceptance, reviewed transport, exact-package clean-machine lifecycle, and withdrawal drill |

Every target also lacks independent exact-download/quarantine verification and
public reputation evidence. Those common gates are required for each final
package and cannot be inferred from the platform-specific observations above.

## Common runtime boundary

- The companion is a foreground, loopback-only application on
  `127.0.0.1:5173` and `127.0.0.1:8788`.
- Safe and Local Actions are distinct mode-bound launchers.
- Elevated Windows and privileged Linux/macOS launches are rejected before
  candidate extraction; supported execution uses one non-elevated identity
  with matching real/effective user and group IDs and no Linux permitted,
  effective, or ambient capabilities.
- The companion installs no service, daemon, registry entry, scheduled task, or
  developer tool. The Windows assurance harness registers one temporary
  scheduled task solely to obtain a noninteractive limited test token and
  requires verified task, process, profile, LSA account-right, and account
  cleanup before passing.
- Local Actions verifies existing tool prerequisites. It does not silently
  install Foundry, Rust, Dusk Forge, WSL, or related utilities.
- Dusk Forge must match the exact reviewed Cargo install receipt and source
  revision.
- Cleanup diagnostics prove only that the lane's exact enumerated
  workflow-owned candidate paths are absent. They do not make a machine-wide
  claim that no other copy exists.
- A developer tool invoked with the user's authority may deliberately detach a
  process beyond the companion's portable cleanup guarantee.

## What is supported today

The hosted Studio is supported as a static, docs-only experience. Repository
source builds are developer workflows. No operating system currently has a
supported public companion download.

Compatibility becomes release evidence only after the exact final packages
receive their required platform trust, cross a reviewed private candidate
transport, pass fresh clean-machine lifecycle checks, and are independently
reviewed. Internal fixtures or same-runner checks must not be relabelled as
those results. The unsigned-assurance JSON is a bounded CI diagnostic, not
authenticated publication evidence.
