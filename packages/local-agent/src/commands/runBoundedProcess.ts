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

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      child.kill("SIGKILL");
      return;
    }
  }

  await new Promise<void>((resolve) => {
    const environment = createChildEnvironment();
    let taskkill: string;
    let taskkillCwd: string;
    try {
      taskkill = resolveWindowsSystemExecutable("taskkill.exe", environment);
      taskkillCwd = resolveWindowsSystemDirectory(environment);
    } catch {
      child.kill("SIGKILL");
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
      child.kill("SIGKILL");
      finish();
    }, 2_000);
    killer.once("error", () => {
      child.kill("SIGKILL");
      finish();
    });
    killer.once("close", (code) => {
      if (code !== 0) child.kill("SIGKILL");
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
