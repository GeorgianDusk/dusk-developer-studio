# Companion support and incident route

Date: 2026-07-18

Status: procedure ready; public companion distribution disabled

Owner: George (`@GeorgianDusk`)

## Supported route

The canonical public support route is the repository's
[bug-report form](https://github.com/GeorgianDusk/dusk-developer-studio/issues/new?template=bug_report.yml).
It covers public, non-sensitive defects in the hosted Studio, source checkout,
documentation, build pipeline, and local companion.

The canonical confidential route is
[GitHub private vulnerability reporting](https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new).
Use it for exploitable behavior, suspected secret exposure, signature or
package-integrity failures, unexpected non-loopback binding, or a credible
supply-chain compromise.

The initial public-triage target is seven calendar days (168 hours). It is a
target for this personal project, not a service-level guarantee. Security
reports follow the acknowledgement and disclosure boundary in
[SECURITY.md](../../SECURITY.md).

## Current availability

There is no supported public companion executable. Source and documentation
support can operate now, but no issue, comment, direct message, mirror, draft
release, or Actions artifact is an approved binary channel.

A request about a purported public binary is therefore treated as a possible
distribution incident. Ask for the URL and non-sensitive hashes, not the file
itself, and follow the
[quarantine and withdrawal procedure](companion-quarantine-and-withdrawal.md).

## Triage

1. Confirm whether the report is public-safe. Move exploitable or
   secret-bearing material to private vulnerability reporting without quoting
   it publicly.
2. Record the affected full commit or version, platform and architecture,
   Studio mode, expected behavior, sanitized symptom, and reproduction status.
3. Classify the affected boundary:
   - hosted static Studio;
   - source checkout or build;
   - companion bootstrap, session, or parity;
   - Safe or Local Actions capability;
   - payload, package, signature, or provenance;
   - loopback listener, child process, filesystem, or cleanup; or
   - third-party developer tool.
4. Assign severity:
   - **Critical:** credible secret exposure, remote companion exposure,
     arbitrary execution, or supply-chain compromise;
   - **High:** integrity, signature, authentication, sandbox, or containment
     failure without confirmed exploitation;
   - **Medium:** reproducible unsafe failure or major workflow breakage; or
   - **Low:** bounded defect, confusing recovery, compatibility, or
     documentation issue.
5. For Critical or High findings, stop any candidate work and invoke the
   [quarantine and withdrawal procedure](companion-quarantine-and-withdrawal.md).
   Publication remains disabled until the finding is resolved and independently
   reviewed.

## Safe evidence

Support records may contain:

- repository, issue, workflow-run, or release URLs under the canonical
  repository;
- full Git commit, release tag, platform target, and mode;
- SHA-256 digests, byte sizes, manifest identifiers, and bounded timestamps;
- sanitized tool versions and reproduction steps; and
- listener addresses limited to the documented Studio loopback ports.

Support records must not contain wallet secrets, credentials, pairing tokens,
cookies, environment dumps, private keys, signing material, personal paths,
funded-account data, or an uploaded suspect executable.

## Route readiness

The repository paths and redaction contract are statically validated. A real
response-time rehearsal and an end-to-end private incident exercise have not
been recorded for a distributable companion because no signed distributable
exists. This procedure alone does not satisfy public-release support evidence.
