import { spawn, type ChildProcess } from "node:child_process";
import { createChildEnvironment } from "./childEnvironment";
import {
  resolveExecutableForSpawn,
  resolveExecutionDirectory,
  resolveWindowsSystemDirectory,
  resolveWindowsSystemExecutable
} from "./executableResolution";

export type ProcessFailureReason = "spawn" | "timeout" | "output_limit" | "exit" | "signal";

export class BoundedProcessError extends Error {
  constructor(
    message: string,
    readonly reason: ProcessFailureReason,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null
  ) {
    super(message);
  }
}

export interface BoundedProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inheritedCwd?: string;
  trustedPathAdditions?: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface BoundedProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const activeChildren = new Set<ChildProcess>();

async function readPosixDescendantPids(rootPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    const environment = createChildEnvironment();
    const processList = spawn("/bin/ps", ["-axo", "pid=,ppid="], {
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const chunks: Buffer[] = [];
    let capturedBytes = 0;
    const maximumBytes = 1024 * 1024;
    const finish = (pids: number[]) => {
      clearTimeout(timer);
      resolve(pids);
    };
    processList.stdout?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maximumBytes - capturedBytes);
      if (remaining > 0) {
        const captured = buffer.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
      if (buffer.length > remaining) processList.kill("SIGKILL");
    });
    processList.once("error", () => finish([]));
    processList.once("close", (code) => {
      if (code !== 0) {
        finish([]);
        return;
      }
      const childrenByParent = new Map<number, number[]>();
      for (const line of Buffer.concat(chunks).toString("utf8").split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
        if (!match) continue;
        const pid = Number(match[1]);
        const parentPid = Number(match[2]);
        if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parentPid)) continue;
        const children = childrenByParent.get(parentPid) ?? [];
        children.push(pid);
        childrenByParent.set(parentPid, children);
      }
      const descendants: number[] = [];
      const pending = [...(childrenByParent.get(rootPid) ?? [])];
      const seen = new Set<number>();
      while (pending.length) {
        const pid = pending.shift();
        if (!pid || seen.has(pid) || pid === process.pid) continue;
        seen.add(pid);
        descendants.push(pid);
        pending.push(...(childrenByParent.get(pid) ?? []));
      }
      finish(descendants);
    });
    const timer = setTimeout(() => {
      processList.kill("SIGKILL");
      finish([]);
    }, 1_000);
    timer.unref();
  });
}

function killChildIfStillRunning(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // The tracked process may have exited between the state check and signal.
  }
}

async function waitForTrackedChildExit(child: ChildProcess, graceMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(
      child.exitCode !== null || child.signalCode !== null
    ), graceMs);
    timer.unref();
    child.once("exit", onExit);
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32") {
    const descendants = await readPosixDescendantPids(child.pid);
    for (const pid of descendants.reverse()) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Ordinary descendants share the root group; detached group leaders
        // are signalled here and the root group is signalled below.
      }
    }
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      killChildIfStillRunning(child);
      return;
    }
  }

  // A short-lived child can finish between the output/timeout signal and the
  // taskkill spawn. Waiting for its tracked exit avoids targeting a PID that
  // Windows has already recycled to an unrelated same-user process.
  if (await waitForTrackedChildExit(child, 75)) return;

  await new Promise<void>((resolve) => {
    const environment = createChildEnvironment();
    let taskkill: string;
    let taskkillCwd: string;
    try {
      taskkill = resolveWindowsSystemExecutable("taskkill.exe", environment);
      taskkillCwd = resolveWindowsSystemDirectory(environment);
    } catch {
      killChildIfStillRunning(child);
      resolve();
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      cwd: taskkillCwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    const timer = setTimeout(() => {
      killer.kill("SIGKILL");
      killChildIfStillRunning(child);
      finish();
    }, 2_000);
    killer.once("error", () => {
      killChildIfStillRunning(child);
      finish();
    });
    killer.once("close", (code) => {
      if (code !== 0) killChildIfStillRunning(child);
      finish();
    });
  });
}

export async function terminateAllBoundedProcesses(): Promise<void> {
  await Promise.all([...activeChildren].map((child) => terminateProcessTree(child)));
}

export function runBoundedProcess(options: BoundedProcessOptions): Promise<BoundedProcessResult> {
  if (options.timeoutMs <= 0 || options.maxOutputBytes <= 0) {
    throw new Error("Process timeout and output limits must be positive.");
  }

  const inheritedCwd = options.inheritedCwd ?? process.cwd();
  const environment = createChildEnvironment(options.env ?? process.env, {
    trustedPathAdditions: options.trustedPathAdditions,
    inheritedCwd
  });
  let command = options.command;
  let cwd = options.cwd;
  try {
    if (process.platform === "win32") {
      cwd = resolveExecutionDirectory(options.cwd, environment);
    } else if (options.cwd) {
      cwd = resolveExecutionDirectory(options.cwd, environment);
    }
    command = resolveExecutableForSpawn(options.command, environment, {
      inheritedCwd,
      trustedPathDirectories: options.trustedPathAdditions
    });
  } catch {
    return Promise.reject(new BoundedProcessError(
      "Process could not be started.",
      "spawn",
      "",
      "",
      null
    ));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, options.args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeChildren.add(child);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let failure: ProcessFailureReason | undefined;

    const capture = (destination: Buffer[], chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, options.maxOutputBytes - capturedBytes);
      if (remaining > 0) {
        const captured = buffer.subarray(0, remaining);
        destination.push(captured);
        capturedBytes += captured.length;
      }
      if (buffer.length > remaining && !failure) {
        failure = "output_limit";
        void terminateProcessTree(child);
      }
    };

    child.stdout.on("data", (chunk) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => capture(stderrChunks, chunk));
    child.once("error", () => {
      if (!failure) failure = "spawn";
    });

    const timeout = setTimeout(() => {
      if (!failure) {
        failure = "timeout";
        void terminateProcessTree(child);
      }
    }, options.timeoutMs);
    timeout.unref();

    child.once("close", (code, signal) => {
      activeChildren.delete(child);
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const reason = failure ?? (signal ? "signal" : code === 0 ? undefined : "exit");
      if (reason) {
        const message = reason === "timeout"
          ? "Process timed out."
          : reason === "output_limit"
            ? "Process output exceeded the configured limit."
            : reason === "spawn"
              ? "Process could not be started."
              : "Process exited unsuccessfully.";
        reject(new BoundedProcessError(message, reason, stdout, stderr, code));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
