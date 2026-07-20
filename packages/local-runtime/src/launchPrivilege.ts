import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolveWindowsSystemExecutable } from "@dusk/local-agent/executable";

export const ELEVATED_LAUNCH_DENIAL = "Dusk Developer Studio refuses elevated or root execution.";

interface FileIdentity {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface WindowsWhoamiProbeOptions {
  encoding: "utf8";
  shell: false;
  windowsHide: true;
  timeout: 10_000;
  maxBuffer: 1_048_576;
}

interface WindowsWhoamiProbeResult {
  error?: unknown;
  signal?: NodeJS.Signals | null;
  status: number | null;
  stdout?: unknown;
}

export interface WindowsLaunchPrivilegeProbe {
  systemRoot: string | undefined;
  lstat(file: string): FileIdentity;
  realpath(file: string): string;
  runWhoami(
    file: string,
    args: readonly ["/groups"],
    options: WindowsWhoamiProbeOptions
  ): WindowsWhoamiProbeResult;
}

function denyElevatedLaunch(): never {
  throw new Error(ELEVATED_LAUNCH_DENIAL);
}

export interface LinuxCapabilitySets {
  permitted: bigint;
  effective: bigint;
  ambient: bigint;
}

const ZERO_LINUX_CAPABILITY_SETS: LinuxCapabilitySets = {
  permitted: 0n,
  effective: 0n,
  ambient: 0n
};

function parseLinuxCapabilityField(status: string, label: string, record: RegExp): bigint {
  const candidates = status.split("\n").filter((line) => line.startsWith(`${label}:`));
  if (candidates.length !== 1) denyElevatedLaunch();
  const match = candidates[0].match(record);
  if (!match) denyElevatedLaunch();
  try {
    return BigInt(`0x${match[1]}`);
  } catch {
    denyElevatedLaunch();
  }
}

export function parseLinuxCapabilitySets(status: unknown): LinuxCapabilitySets {
  if (typeof status !== "string") denyElevatedLaunch();
  return {
    permitted: parseLinuxCapabilityField(status, "CapPrm", /^CapPrm:[ \t]*([0-9A-Fa-f]+)[ \t]*\r?$/),
    effective: parseLinuxCapabilityField(status, "CapEff", /^CapEff:[ \t]*([0-9A-Fa-f]+)[ \t]*\r?$/),
    ambient: parseLinuxCapabilityField(status, "CapAmb", /^CapAmb:[ \t]*([0-9A-Fa-f]+)[ \t]*\r?$/)
  };
}

export function assertPosixLaunchIdentity(
  uid: unknown,
  euid: unknown,
  gid: unknown,
  egid: unknown,
  capabilitySets: unknown = ZERO_LINUX_CAPABILITY_SETS
): void {
  const capabilities = capabilitySets as Partial<LinuxCapabilitySets> | null;
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(euid)
      || !Number.isSafeInteger(gid) || !Number.isSafeInteger(egid)
      || (uid as number) < 0 || (euid as number) < 0
      || (gid as number) < 0 || (egid as number) < 0
      || uid === 0 || euid === 0 || uid !== euid
      || gid !== egid
      || typeof capabilitySets !== "object" || capabilitySets === null
      || typeof capabilities?.permitted !== "bigint" || capabilities.permitted !== 0n
      || typeof capabilities.effective !== "bigint" || capabilities.effective !== 0n
      || typeof capabilities.ambient !== "bigint" || capabilities.ambient !== 0n) {
    denyElevatedLaunch();
  }
}

function parseIntegrityRid(output: unknown): number {
  if (typeof output !== "string") denyElevatedLaunch();
  const prefixes = output.match(/S-1-16-/gi) ?? [];
  const matches = [...output.matchAll(/(^|[^A-Za-z0-9-])S-1-16-(0|[1-9][0-9]*)(?![A-Za-z0-9-])/gi)];
  if (prefixes.length !== 1 || matches.length !== 1) denyElevatedLaunch();
  const rid = Number(matches[0][2]);
  if (!Number.isSafeInteger(rid) || rid < 0) denyElevatedLaunch();
  return rid;
}

export function assertWindowsNonElevatedLaunch(probe: WindowsLaunchPrivilegeProbe): void {
  let whoami: string;
  try {
    whoami = resolveWindowsSystemExecutable(
      "whoami.exe",
      { SystemRoot: probe.systemRoot },
      {
        platform: "win32",
        systemRoot: probe.systemRoot,
        lstat: probe.lstat,
        realpath: probe.realpath
      }
    );
  } catch {
    denyElevatedLaunch();
  }
  let identity: FileIdentity;
  try {
    identity = probe.lstat(whoami);
  } catch {
    denyElevatedLaunch();
  }
  if (!identity.isFile() || identity.isSymbolicLink()) denyElevatedLaunch();

  let result: WindowsWhoamiProbeResult;
  try {
    result = probe.runWhoami(whoami, ["/groups"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1_048_576
    });
  } catch {
    denyElevatedLaunch();
  }
  if (result.error || result.status !== 0 || result.signal) denyElevatedLaunch();
  if (parseIntegrityRid(result.stdout) >= 12_288) denyElevatedLaunch();
}

export function assertNonElevatedLaunch(): void {
  if (process.platform === "win32") {
    assertWindowsNonElevatedLaunch({
      systemRoot: process.env.SystemRoot,
      lstat: (file) => lstatSync(file),
      realpath: (file) => realpathSync.native(file),
      runWhoami: (file, args, options) => {
        const result = spawnSync(file, [...args], options);
        return { error: result.error, signal: result.signal, status: result.status, stdout: result.stdout };
      }
    });
    return;
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    if (typeof process.getuid !== "function" || typeof process.geteuid !== "function"
        || typeof process.getgid !== "function" || typeof process.getegid !== "function") {
      denyElevatedLaunch();
    }
    let uid: unknown;
    let euid: unknown;
    let gid: unknown;
    let egid: unknown;
    try {
      uid = process.getuid();
      euid = process.geteuid();
      gid = process.getgid();
      egid = process.getegid();
    } catch {
      denyElevatedLaunch();
    }
    let capabilitySets: LinuxCapabilitySets = ZERO_LINUX_CAPABILITY_SETS;
    if (process.platform === "linux") {
      try {
        capabilitySets = parseLinuxCapabilitySets(readFileSync("/proc/self/status", "utf8"));
      } catch {
        denyElevatedLaunch();
      }
    }
    assertPosixLaunchIdentity(uid, euid, gid, egid, capabilitySets);
    return;
  }
  denyElevatedLaunch();
}
