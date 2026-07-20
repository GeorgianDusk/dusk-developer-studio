// @vitest-environment node

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ELEVATED_LAUNCH_DENIAL,
  assertPosixLaunchIdentity,
  assertWindowsNonElevatedLaunch,
  parseLinuxCapabilitySets,
  type WindowsLaunchPrivilegeProbe
} from "../launchPrivilege";

function windowsProbe(overrides: Partial<WindowsLaunchPrivilegeProbe> = {}): WindowsLaunchPrivilegeProbe {
  return {
    systemRoot: "C:\\Windows",
    lstat: () => ({ isFile: () => true, isSymbolicLink: () => false }),
    runWhoami: () => ({
      status: 0,
      signal: null,
      stdout: "Mandatory Label\\Medium Mandatory Level Label  S-1-16-8192"
    }),
    ...overrides
  };
}

function expectDenied(action: () => void): void {
  expect(action).toThrow(ELEVATED_LAUNCH_DENIAL);
}

describe("non-elevated launch guard", () => {
  it("allows only matching valid non-root POSIX user and group identities", () => {
    expect(() => assertPosixLaunchIdentity(1_000, 1_000, 1_000, 1_000)).not.toThrow();
    for (const [uid, euid, gid, egid] of [
      [0, 1_000, 1_000, 1_000],
      [1_000, 0, 1_000, 1_000],
      [1_000, 501, 1_000, 1_000],
      [undefined, 1_000, 1_000, 1_000],
      [1_000, undefined, 1_000, 1_000],
      [-1, 1_000, 1_000, 1_000],
      [1_000, -1, 1_000, 1_000],
      [1.5, 1_000, 1_000, 1_000],
      [1_000, Number.NaN, 1_000, 1_000],
      ["1000", 1_000, 1_000, 1_000],
      [1_000, 1_000, undefined, 1_000],
      [1_000, 1_000, 1_000, undefined],
      [1_000, 1_000, -1, 1_000],
      [1_000, 1_000, 1_000, -1],
      [1_000, 1_000, 1.5, 1_000],
      [1_000, 1_000, 1_000, Number.NaN],
      [1_000, 1_000, 1_000, 501]
    ]) {
      expectDenied(() => assertPosixLaunchIdentity(uid, euid, gid, egid));
    }
  });

  it("requires exactly one parseable record for every relevant Linux capability set", () => {
    expect(parseLinuxCapabilitySets(
      "Name:\tnode\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapAmb:\t0000000000000000\n"
    )).toEqual({ permitted: 0n, effective: 0n, ambient: 0n });
    expect(parseLinuxCapabilitySets(
      "CapPrm:\t0000000000000001\nCapEff:\t0000000000000400\nCapAmb:\t0000000000002000\n"
    )).toEqual({ permitted: 1n, effective: 0x400n, ambient: 0x2000n });
    for (const status of [
      "",
      "CapPrm:\t0000\nCapEff:\t0000\n",
      "CapEff:\t0000\nCapAmb:\t0000\n",
      "CapPrm:\t0000\nCapAmb:\t0000\n",
      "CapPrm:\tnot-hex\nCapEff:\t0000\nCapAmb:\t0000\n",
      "CapPrm:\t0000\nCapEff:\tnot-hex\nCapAmb:\t0000\n",
      "CapPrm:\t0000\nCapEff:\t0000\nCapAmb:\tnot-hex\n",
      "CapPrm:\t0000\nCapPrm:\t0000\nCapEff:\t0000\nCapAmb:\t0000\n",
      "CapPrm:\t0000\nCapEff:\t0000\nCapEff:\t0000\nCapAmb:\t0000\n",
      "CapPrm:\t0000\nCapEff:\t0000\nCapAmb:\t0000\nCapAmb:\t0000\n"
    ]) {
      expectDenied(() => parseLinuxCapabilitySets(status));
    }
  });

  it("denies every nonzero or malformed relevant Linux capability set", () => {
    const zero = { permitted: 0n, effective: 0n, ambient: 0n };
    expect(() => assertPosixLaunchIdentity(1_000, 1_000, 1_000, 1_000, zero)).not.toThrow();
    for (const capabilitySets of [
      { ...zero, permitted: 1n },
      { ...zero, effective: 1n },
      { ...zero, ambient: 1n },
      { effective: 0n, ambient: 0n },
      { permitted: 0n, ambient: 0n },
      { permitted: 0n, effective: 0n },
      { ...zero, permitted: "0" },
      null,
      "zero"
    ]) {
      expectDenied(() => assertPosixLaunchIdentity(1_000, 1_000, 1_000, 1_000, capabilitySets));
    }
  });

  it("uses only the fixed regular non-symlink SystemRoot whoami executable", () => {
    let inspected = "";
    let invoked = "";
    let invokedArgs: readonly string[] = [];
    let invokedOptions: unknown;
    assertWindowsNonElevatedLaunch(windowsProbe({
      systemRoot: "D:/Windows",
      lstat: (file) => {
        inspected = file;
        return { isFile: () => true, isSymbolicLink: () => false };
      },
      runWhoami: (file, args, options) => {
        invoked = file;
        invokedArgs = args;
        invokedOptions = options;
        return { status: 0, signal: null, stdout: "S-1-16-12287" };
      }
    }));
    expect(inspected).toBe("D:\\Windows\\System32\\whoami.exe");
    expect(invoked).toBe(inspected);
    expect(invokedArgs).toEqual(["/groups"]);
    expect(invokedOptions).toMatchObject({
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1_048_576
    });

    for (const systemRoot of [
      undefined,
      "",
      "Windows",
      "C:Windows",
      "\\Windows",
      "\\\\server\\Windows",
      "\\\\?\\C:\\Windows",
      " C:\\Windows",
      "C:\\Windows ",
      "C:\\Win:dows",
      "C:\\Win*dows"
    ]) {
      expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({ systemRoot })));
    }
  });

  it("fails closed when whoami is missing, non-regular, or a symlink", () => {
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      lstat: () => { throw new Error("missing"); }
    })));
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      lstat: () => ({ isFile: () => false, isSymbolicLink: () => false })
    })));
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      lstat: () => ({ isFile: () => true, isSymbolicLink: () => true })
    })));
  });

  it("allows a single integrity RID below high-integrity and denies high-integrity", () => {
    for (const rid of [0, 4_096, 8_192, 12_287]) {
      expect(() => assertWindowsNonElevatedLaunch(windowsProbe({
        runWhoami: () => ({ status: 0, signal: null, stdout: `label,S-1-16-${rid},enabled` })
      }))).not.toThrow();
    }
    for (const rid of [12_288, 16_384, 20_480]) {
      expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
        runWhoami: () => ({ status: 0, signal: null, stdout: `S-1-16-${rid}` })
      })));
    }
  });

  it("fails closed on missing, multiple, malformed, or unbounded integrity output", () => {
    for (const stdout of [
      "",
      "no integrity label",
      "S-1-16-8192\nS-1-16-4096",
      "S-1-16-08192",
      "S-1-16-8192-1",
      "XS-1-16-8192",
      `S-1-16-${"9".repeat(40)}`
    ]) {
      expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
        runWhoami: () => ({ status: 0, signal: null, stdout })
      })));
    }
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      runWhoami: () => ({ status: 0, signal: null, stdout: undefined })
    })));
  });

  it("fails closed on every whoami probe error", () => {
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      runWhoami: () => { throw new Error("spawn failed"); }
    })));
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      runWhoami: () => ({ status: null, signal: null, stdout: "S-1-16-8192" })
    })));
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      runWhoami: () => ({ status: 1, signal: null, stdout: "S-1-16-8192" })
    })));
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      runWhoami: () => ({ status: 0, signal: "SIGTERM", stdout: "S-1-16-8192" })
    })));
    expectDenied(() => assertWindowsNonElevatedLaunch(windowsProbe({
      runWhoami: () => ({ error: new Error("timeout"), status: 0, signal: null, stdout: "S-1-16-8192" })
    })));
  });

  it("runs before package verification or runtime-owned filesystem work", () => {
    const source = fs.readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function startLocalRuntime");
    const end = source.indexOf("interface SelfTestResponse", start);
    const body = source.slice(start, end);
    const guard = body.indexOf("assertNonElevatedLaunch();");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("resolveCanonicalNpmPackageRoot(options.packageRoot)"));
    expect(guard).toBeLessThan(body.indexOf("verifyNpmPackage("));
    expect(guard).toBeLessThan(body.indexOf("fs.mkdir("));
    expect(guard).toBeLessThan(body.indexOf("listen("));
  });
});
