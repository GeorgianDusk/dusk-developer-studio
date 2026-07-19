# Package quarantine and withdrawal

Use this procedure when the `dusk-developer-studio` npm package has unexpected identity, contents, integrity, provenance, or runtime behavior.

Use the [support and incident route](companion-support-and-incident.md) for reporting and the [local recovery guide](local-companion-recovery.md) for normal startup, shutdown, or session problems.

## Trigger conditions

Quarantine a package version when you observe:

- an unexpected npm owner, package name, repository URL, version, integrity value, or provenance record;
- dependencies or install lifecycle scripts that should not exist;
- files outside the documented package inventory;
- a frontend/runtime identity mismatch;
- an unexpected non-loopback listener;
- an authentication, origin, Host, pairing, or capability-boundary failure;
- a credible supply-chain or secret-exposure report; or
- materially different behavior from the same recorded version.

Do not rerun a suspect version merely to collect more evidence.

## User quarantine

1. Stop the foreground Studio with `Ctrl+C`.
2. Confirm ports 5173 and 8788 are closed.
3. Preserve user projects; they live outside the npm cache.
4. Record the exact package name, version, registry URL, integrity value, repository URL, platform, Node.js version, time observed, and sanitized symptom.
5. Compare registry metadata without executing the package:

   ```bash
   npm view dusk-developer-studio name version license repository engines dependencies scripts dist.integrity dist.tarball
   ```

6. Run `npm cache verify` to validate the npm cache.
7. Report exploitable, credential, integrity, provenance, or supply-chain concerns through [GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new).
8. Use a public bug report only when every detail is safe to disclose.

Do not upload suspect package contents to an issue, comment, shared drive, direct message, or third-party scanner.

## Maintainer response

For an affected package version:

1. reproduce the report in an isolated account and directory without wallet data;
2. stop recommending the affected version;
3. deprecate the exact affected version with a concise recovery message;
4. publish a corrected new version after the full package and cross-platform checks pass;
5. update the repository advisory or sanitized incident notice with affected versions, impact, and recovery steps;
6. verify the npm metadata, repository links, integrity, provenance, and package contents of the replacement; and
7. check that issues, comments, and mirrors are not presented as alternative package sources.

npm versions are immutable. Do not replace files under an existing version. Prefer deprecation and a corrected version; reserve unpublish for the narrow cases allowed by npm policy.

## Local rollback

If a known unaffected version is required for diagnosis:

```bash
npx dusk-developer-studio@<version>
```

Use the exact recorded version, do not combine files across versions, and keep Local Actions off unless the investigation specifically requires it.

## Preserve useful evidence

Safe incident evidence includes:

- package name and version;
- registry and repository URLs;
- `dist.integrity` and tarball URL;
- provenance reference;
- platform, architecture, and Node.js version;
- Safe or Local Actions mode;
- documented loopback listener state; and
- sanitized reproduction steps and errors.

Never include wallet secrets, credentials, cookies, pairing material, environment dumps, absolute user paths, funded-account data, or private incident discussion.
