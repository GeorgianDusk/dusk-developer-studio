# Same-User Tool Boundary Decision

Date: 2026-07-18

Status: accepted

Owner: George

## Decision

For the current personal-project, source-only and internal companion scope,
George accepts that an allowlisted developer tool invoked by Local Actions
already runs with the developer's non-elevated account authority. The Studio
refuses elevated Windows and root Linux/macOS execution before candidate
extraction. It guarantees bounded execution and cleanup for the direct
processes and ordinary process groups it tracks, but does not claim
machine-wide containment or cleanup of a tool that deliberately creates a
fully detached same-user process.

This is an explicit maintainer risk decision. It is not an independent security
review, does not approve public binary publication, and does not change the
fail-closed release policy. Windows and Apple signing identities remain
intentionally unconfigured, candidate transport remains disabled, and unsigned
executables must not be promoted as trusted downloads.

## Controls retained

- Safe and Local Actions use separate mode-bound launchers.
- Elevated Windows and privileged Linux/macOS launches fail closed before
  candidate extraction; the product and CI expose no supported override.
- Local Actions exposes exact allowlisted commands and arguments. Fixed,
  reviewed shell wrappers are used only for Windows command shims and the
  bounded optional WSL probe; users cannot supply shell text or arbitrary
  commands.
- Child tools receive a minimal environment with secret-shaped values removed.
- Time, output, request concurrency, and Studio-managed staging and promotion
  effects remain bounded. The invoked tool's own same-user filesystem, network,
  and process effects are not OS-sandboxed.
- Timeout, overflow, and shutdown terminate tracked direct processes or
  ordinary process groups.
- Studio-owned listeners are checked before and after preflight, and both fixed
  loopback ports must close after shutdown.
- Lifecycle evidence is limited to Studio-owned services and runner-owned
  install or extraction paths; it never claims machine-wide process cleanup.
- Public companion binaries remain disabled.

## Accepted residual risk

A hostile or compromised allowlisted tool can read, write, communicate over the
network, and create processes with the non-elevated developer account's
authority while it runs. It can also deliberately create a detached process
that survives Studio shutdown and escapes portable child-process tracking. The
developer may need to identify and stop that process and remediate other
same-user effects using platform tools. The elevation guard prevents accidental
privileged use; it is not containment against an administrator or root user who
can modify an unsigned program or its environment.

## What this decision does not approve

This decision does not accept an independent companion security review, approve
a candidate, authenticate review evidence, enable private candidate transport,
configure a Windows or Apple signing identity, or authorize any public
executable release. Those remain separate fail-closed gates.

## Revisit triggers

Reopen this decision before:

- publishing any companion binary;
- allowing arbitrary project commands;
- adding package installation or update capabilities;
- materially expanding the tool allowlist;
- adding administrator, background-service, or daemon capabilities; or
- closing a security incident involving an invoked same-user tool.
