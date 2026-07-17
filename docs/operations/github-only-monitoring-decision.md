# GitHub-Only Monitoring Decision

Date: 2026-07-17

Status: accepted

Owner: George

## Decision

Dusk Developer Studio uses GitHub-only production monitoring. No third-party
uptime or dead-man provider account, heartbeat URL, direct-health check, or
provider credential is required for Phase 5.

This is an explicit owner-approved risk decision for a personal open-source
project. It is not evidence that GitHub is operationally independent of the
system it monitors.

## Controls retained

- the six-hour `Studio public deployment assurance` schedule;
- exact-commit release, route, cache, TLS, source, DuskDS node, and closed-port
  verification;
- desktop and mobile public-path browser coverage;
- assigned GitHub issue creation, reclassification, and recovery closure;
- the separately scheduled `Studio same-platform monitor schedule guard`;
- a bounded schedule-guard receipt bound to the canonical workflow and run;
- manual assigned-issue alert-delivery rehearsal.

## Accepted residual risk

A GitHub-wide Actions or Issues outage can suppress both the primary assurance
run and its alert. A workflow that never starts cannot notify an outside
provider, and no independent service continuously probes `/healthz`.

George accepts that residual risk for the current personal-project scope.
Scheduled GitHub assurance and its same-platform guard remain launch-gating;
they must not be disabled or silently converted to best-effort checks.

## Revisit triggers

Reopen the external-monitoring decision before:

- publishing companion binaries to the public;
- making service-level or commercial commitments;
- relying on the Studio for time-critical developer operations;
- responding to a monitoring-blindness incident;
- a material increase in external developer usage.

Reintroducing external monitoring requires a reviewed policy change, distinct
dead-man and direct-health check identities, secret-safe configuration, and
real alert/recovery evidence.
