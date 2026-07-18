# Security Policy

## Supported surface

Security fixes target the current `main` branch and the latest published release, if one exists. No public companion binary is currently supported; source-checkout development remains a developer workflow.

## Reporting a vulnerability

Do not open a public issue containing an exploitable vulnerability, secret, or
unredacted diagnostic. Use
[GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new).
If that feature is temporarily unavailable, open a minimal public issue
requesting a private security contact without describing the vulnerability.

Include the affected commit or version, platform, impact, reproducible steps, and a minimal proof of concept with all credentials and personal data removed. You should receive an acknowledgement within seven days; timelines for remediation and disclosure depend on severity and reproducibility.

For non-sensitive product and documentation problems, use the route in
[SUPPORT.md](SUPPORT.md).

## Hard boundaries

- The companion must bind only to loopback and must never be exposed from a VPS.
- No private key, mnemonic, wallet password, seeder, profile entropy, API key, or signing credential may enter logs, diagnostics, fixtures, issues, or repository history.
- Public companion downloads remain blocked until the signing, clean-machine, independent review, support, and rollback gates in `docs/deployment/companion-release.md` pass.
