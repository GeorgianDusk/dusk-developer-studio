# Local Studio support and incident route

## Support routes

Use the [GitHub bug-report form](https://github.com/GeorgianDusk/dusk-developer-studio/issues/new?template=bug_report.yml) for public, non-sensitive defects in:

- the Hosted guide;
- the `dusk-developer-studio` npm package;
- Safe or Local Actions;
- startup, pairing, parity, shutdown, or project handling;
- documentation or local development; or
- an allowlisted developer-tool check.

Use [GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new) for exploitable behavior, suspected secret exposure, package-integrity or provenance failures, unexpected non-loopback binding, authentication bypass, arbitrary execution, or a credible supply-chain compromise.

The initial public-triage target is seven calendar days. It is a target for this personal project, not a service-level guarantee.

## Before reporting

For ordinary startup, session, tool, or shutdown problems, follow [Local Studio recovery](local-companion-recovery.md).

For suspicious package identity or behavior, stop the package and follow [Package quarantine and withdrawal](companion-quarantine-and-withdrawal.md).

## Triage information

Record:

- hosted URL, npm package version, or full commit;
- operating system and architecture;
- Node.js and browser version;
- Safe or Local Actions mode;
- expected and actual behavior;
- sanitized reproduction steps;
- whether ports 5173 and 8788 opened and closed as expected; and
- package integrity or provenance metadata when relevant.

Do not include wallet secrets, credentials, cookies, pairing values, environment dumps, absolute paths, funded-account information, or suspect package files.

## Severity

- **Critical:** credible secret exposure, public companion exposure, arbitrary execution, authentication bypass with capabilities, or supply-chain compromise.
- **High:** integrity, provenance, origin, Host, filesystem, process, or containment failure without confirmed exploitation.
- **Medium:** reproducible unsafe failure or a major supported-workflow break.
- **Low:** bounded defect, compatibility issue, confusing recovery, or documentation problem.

Critical and High findings require immediate package quarantine and suspension of affected-version use until the issue is resolved and reviewed.

## Boundary classification

Classify the report as one of:

- Hosted guide or static deployment;
- npm package identity or contents;
- local startup, browser bootstrap, session, or parity;
- Safe or Local Actions capability;
- loopback listener or request security;
- child process, environment, filesystem, or cleanup;
- user project preservation; or
- third-party developer tool behavior.

This distinction matters because a third-party tool runs with the developer's authority, while the Studio controls only its own allowlisted invocation, tracked process, project scope, and loopback services.
