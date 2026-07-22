# Security Policy

## Supported surface

Security fixes target:

- the Hosted guide at `https://studio.134-122-59-217.nip.io`;
- the `dusk-developer-studio` package from the public npm registry; and
- the current `main` branch.

The local Studio requires Node.js `>=24.18.0 <25`.

## Reporting a vulnerability

Do not open a public issue containing an exploitable vulnerability, secret, suspect package content, or unredacted diagnostic.

Use [GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new). If that route is unavailable, open a minimal public issue requesting private contact without describing the vulnerability.

Include:

- the affected hosted URL, npm package version, or full commit;
- operating system and architecture;
- Safe or Local Actions mode;
- impact and reproducible steps;
- the npm registry URL and integrity or provenance details when package identity is involved; and
- a minimal proof of concept with credentials, personal data, wallet data, and local paths removed.

You should receive an acknowledgement within seven days. Remediation and disclosure timing depends on severity and reproducibility.

For non-sensitive product or documentation problems, follow [SUPPORT.md](SUPPORT.md).

## Safe package use

- Run the package only by its exact npm name: `dusk-developer-studio`.
- Confirm the npm package links back to `https://github.com/GeorgianDusk/dusk-developer-studio`.
- Do not run copied package files, issue attachments, direct-message downloads, or third-party mirrors.
- Treat an unexpected package owner, repository URL, version, integrity value, file inventory, install lifecycle script, or dependency as a security concern.
- Follow the [quarantine and withdrawal procedure](docs/operations/companion-quarantine-and-withdrawal.md) when package identity or behavior is suspicious.

For a version-pinned invocation that also refuses npm install lifecycle scripts:

```bash
npm exec --ignore-scripts --package=dusk-developer-studio@1.0.8 -- dusk-developer-studio
npm exec --ignore-scripts --package=dusk-developer-studio@1.0.8 -- dusk-developer-studio local-actions
```

The embedded DuskDS Cargo lock is checked against GitHub advisories and the
RustSec database. See the
[current Cargo advisory review](docs/security/duskds-cargo-advisory-review.md)
for the exact fail-closed policy and time-bounded upstream warning analysis.

## Hard boundaries

- The Hosted guide is static and never connects to services on a developer's machine.
- The local Studio binds only to `127.0.0.1` and must never be exposed from a VPS, container ingress, tunnel, or public interface.
- No private key, mnemonic, seed phrase, wallet password, seeder, profile entropy, API key, credential, cookie, or pairing value may enter logs, diagnostics, fixtures, issues, or repository history.
- Safe mode never runs developer tools or creates projects.
- Local Actions exposes only reviewed commands and arguments, with bounded time, output, environment, concurrency, and filesystem scope.
- The Studio does not install developer toolchains, access wallet secrets, sign transactions, automate deployment, or execute arbitrary commands.
- External tools invoked by Local Actions run with the developer's user authority. The Studio reduces their exposure but cannot contain a malicious tool or a deliberately detached same-user process.

See the [threat model](docs/security/threat-model.md) and [local companion security boundary](docs/security/local-companion-boundary.md) for details.
