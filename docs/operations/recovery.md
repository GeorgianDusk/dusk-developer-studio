# Repository recovery

The canonical source repository is `https://github.com/GeorgianDusk/dusk-developer-studio` after publication.

## Recovery procedure

1. Clone the repository and check out the required clean commit or signed tag.
2. Verify the commit or tag against the recorded release evidence.
3. Install the exact lockfile with Node.js 24.18.0 and pnpm 11.7.0.
4. Run `pnpm check:no-secrets`, `pnpm verify:local`, and the relevant platform or browser gates.
5. Rebuild artifacts rather than restoring generated `dist`, `output`, dependency, credential, pairing, or signing directories from an untrusted backup.
6. Reconfigure external deployment and signing settings from the relevant provider consoles; never store those credentials in the repository.

A recovered source checkout does not authorize publication or deployment. Release and deployment still require the gates and approvals documented in `docs/deployment`.
