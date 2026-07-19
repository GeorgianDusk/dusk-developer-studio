# Companion quarantine, rollback, and withdrawal

Date: 2026-07-18

Status: procedure ready; live distributable drill unavailable

Owner: George (`@GeorgianDusk`)

Use the canonical
[support and incident route](companion-support-and-incident.md) for reporting
and triage, and the [local recovery guide](local-companion-recovery.md) for
bounded startup, shutdown, and session recovery.

## Trigger conditions

Invoke this procedure for:

- an unexpected origin, tag, commit, package name, size, or SHA-256;
- a missing, invalid, or unexpected platform signature or attestation;
- a manifest, launcher-index, payload, or release-parity mismatch;
- a malware, SmartScreen, Gatekeeper, quarantine, or reputation finding;
- an unexpected non-loopback listener or authentication failure;
- a credible supply-chain or secret-exposure report; or
- a public executable that claims to be this companion while publication is
  disabled.

Do not execute a suspect file to confirm a report.

## Quarantine

1. Stop the foreground companion. Verify the Studio-owned listeners on ports
   5173 and 8788 are closed before doing anything with the extracted directory.
2. Disconnect the suspect archive or extraction from normal use. Do not upload
   it to an issue, comment, shared drive, or third-party scanner.
3. Record only the source URL, package name, byte size, SHA-256, claimed tag and
   commit, target, signing status, time observed, and sanitized symptom.
4. Compare those values with the canonical release record. A missing canonical
   record is a mismatch, not permission to trust the file.
5. Use private vulnerability reporting for exploitable, credential, signature,
   provenance, or supply-chain concerns. Use a public bug report only when the
   evidence is safe to disclose.
6. Preserve user projects. They live outside the extracted release and must not
   be deleted as part of companion cleanup.

## Local rollback

The portable companion has no installer, service, registry entry, scheduled
task, or daemon. After a normal shutdown:

1. confirm ports 5173 and 8788 are closed;
2. remove only the exact extracted companion directory after checking its
   resolved path;
3. retain user-created projects unless the user explicitly chooses otherwise;
4. do not kill unrelated Node processes by name; and
5. do not combine files from different versions.

If a future supported release must be rolled back, obtain the previous package
only from the canonical release record, verify its exact digest and platform
trust, extract it into a new directory, and verify release parity before use.
Never repair or downgrade individual files in place.

## Repository withdrawal

There is no public binary to withdraw today. If a future distributable is
published, the incident owner must:

1. disable Studio download links and keep the hosted Studio docs-only;
2. change the release to a clear withdrawn state without replacing assets under
   the same tag or filename;
3. remove public binary assets when preservation would expose users, while
   retaining a non-secret incident record with the revoked digests;
4. invalidate or revoke provider-side platform trust when compromise warrants
   it;
5. publish a repository security advisory or sanitized incident notice with
   affected tags, hashes, impact, and safe recovery steps;
6. keep publication disabled until clean replacement packages pass every
   release gate; and
7. verify that mirrors or issue attachments are not presented as replacements.

Deletion alone is not revocation evidence. The durable incident record must
identify what was withdrawn and why, without redistributing the suspect bytes.

## Drill

For each future release candidate, rehearse against a disposable, non-public
fixture:

1. detect a deliberately mismatched digest;
2. stop before execution;
3. record the bounded quarantine metadata;
4. remove a disposable extraction while preserving a fixture user project;
5. verify both fixed ports are closed;
6. exercise the proposed release-withdrawal steps without exposing a binary;
7. record the owner, timestamps, exact fixture digest, result, and unresolved
   findings; and
8. obtain independent review before treating the drill as release evidence.

The procedure and static contract are ready. No exact signed-package rollback,
real platform revocation, public-asset withdrawal, download reputation result,
or clean-machine drill has occurred because there is no signed distributable or
approved candidate transport. Those gates remain unavailable and must not be
marked passed.
