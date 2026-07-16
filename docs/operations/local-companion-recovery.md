# Local Companion Recovery

Date: 2026-07-15

## Startup Failure

- Payload verification failure: stop. Re-extract a freshly verified archive; do not repair individual files or bypass the manifest.
- Wrong platform or architecture: obtain the matching Windows x64 or Linux x64 archive.
- Port 5173 or 8788 already in use: stop the conflicting local process, then restart. The companion never chooses a different port silently.
- Browser did not open: leave the foreground process running and open http://127.0.0.1:5173 manually. No pairing token belongs in the URL.

## Session Or Parity Failure

- Expired or consumed bootstrap: stop and restart the foreground companion to generate a new in-memory secret and session.
- Release mismatch: close the process, remove the mixed extraction, and extract one complete archive. Never combine Studio assets, runtime files, or manifests from different builds.
- Hosted docs-only message: this is expected for a hosted artifact, including one copied to localhost. Use the approved portable archive instead.

## Local Action Failure

- Safe mode blocks preflight/scaffold requests by design. Stop it and deliberately use the local-actions launcher if those capabilities are required.
- Missing Foundry, Rust, Dusk Forge, WSL, or optional utilities: follow the bounded preflight result. External toolchains are not silently installed.
- Existing project target: choose a new project name or move the existing directory yourself. The companion never merges or overwrites it.
- Interrupted scaffold: the final target should remain absent. Stop the process before inspecting any private stage; do not follow or delete a stage beneath an untrusted/replaced parent.

## Shutdown And Cleanup

Press Ctrl+C in the foreground window. Shutdown terminates active bounded process trees, invalidates in-memory sessions, closes both loopback servers, and leaves user projects in the platform user-data directory. The extracted archive can then be removed normally. No service, registry entry, scheduled task, or daemon cleanup is required.

If a process survives an abnormal host crash, identify the exact bundled Node process listening on 5173 or 8788 before terminating it. Do not kill unrelated Node processes by name.

## Incident Boundary

Quarantine the archive and preserve its archive SHA-256, payload-manifest SHA-256, target, version, commit, signing status, and symptom. Never include wallet secrets, environment dumps, pairing material, absolute user paths, or funded-account data in a support report. A suspected signature, payload, or runtime mismatch is a release incident and blocks publication.
