# Local Companion Recovery

Date: 2026-07-18

## Startup Failure

- Payload verification failure: stop. Re-extract a freshly verified archive; do not repair individual files or bypass the manifest.
- Wrong platform or architecture: stop. The intended targets are Windows x64,
  Linux x64, and macOS arm64, but no public archive is currently distributed.
  A future archive must come from an approved canonical release.
- Port 5173 or 8788 already in use: stop the conflicting local process, then restart. The companion never chooses a different port silently.
- Browser did not open: leave the foreground process running and open http://127.0.0.1:5173 manually. No pairing token belongs in the URL.
- Privileged launch rejected: restart the exact launcher from one normal,
  non-elevated developer identity with matching real/effective user and group
  IDs and no Linux permitted, effective, or ambient capabilities. Do not add a
  bypass or run Local Actions as administrator/root.

## Session Or Parity Failure

- Expired or consumed bootstrap: stop and restart the foreground companion to generate a new in-memory secret and session.
- Release mismatch: close the process, remove the mixed extraction, and extract one complete archive. Never combine Studio assets, runtime files, or manifests from different builds.
- Hosted docs-only message: this is expected for a hosted artifact, including
  one copied to localhost. Current public users should stay with the hosted
  manual/source workflow because no public archive is approved. Only separately
  authorized internal testers may use an exact internal candidate; after a
  future publication approval, use only the canonical approved release.

## Local Action Failure

- Safe mode blocks preflight/scaffold requests by design. Stop it and deliberately use the local-actions launcher if those capabilities are required.
- Missing Foundry, Rust, Dusk Forge, WSL, or optional utilities: follow the bounded preflight result. External toolchains are not silently installed.
- Existing project target: choose a new project name or move the existing directory yourself. The companion never merges or overwrites it.
- Interrupted scaffold: the final target should remain absent. Stop the process before inspecting any private stage; do not follow or delete a stage beneath an untrusted/replaced parent.

## Shutdown And Cleanup

Press Ctrl+C in the foreground window. For a macOS app opened from Finder,
quit the exact **Dusk Developer Studio** or **Dusk Developer Studio Local
Actions** app normally; if it does not quit, use Activity Monitor to send Quit
to that exact app or PID. Shutdown terminates active tracked child processes,
invalidates in-memory sessions, closes both Studio-owned loopback servers, and
leaves user projects in the platform user-data directory. Confirm ports 5173
and 8788 are closed before removing the extracted archive. The Studio installs
no service, registry entry, scheduled task, or daemon. A separate developer tool
invoked by Local Actions runs with your account authority; if that tool is
compromised, its deliberately detached processes are outside the Studio's
portable cleanup guarantee.

If a process survives an abnormal host crash, identify the exact bundled Node process listening on 5173 or 8788 before terminating it. Do not kill unrelated Node processes by name.

## Incident Boundary

Quarantine the archive and preserve its archive SHA-256, target, version,
commit, signing status, sanitized symptom, and any candidate-manifest,
launcher-index, or build-receipt identifiers and hashes already emitted by a
trusted verifier. Preserve an embedded payload fingerprint only when that
trusted verifier already reported it; do not execute or unpack a suspect
launcher merely to derive one. Never include wallet secrets, environment dumps,
pairing material, absolute user paths, or funded-account data in a support
report. A suspected signature, payload, or runtime mismatch is a release
incident and blocks publication.

Follow the canonical
[support and incident route](companion-support-and-incident.md) and
[quarantine, rollback, and withdrawal procedure](companion-quarantine-and-withdrawal.md).
