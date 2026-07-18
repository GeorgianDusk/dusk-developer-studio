// @vitest-environment node

import { describe, expect, it } from "vitest";
import { BoundedProcessError, runBoundedProcess, terminateAllBoundedProcesses } from "../commands/runBoundedProcess";

describe("bounded process runner", () => {
  function isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it("captures a successful allowlisted process result", async () => {
    const result = await runBoundedProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ready')"],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096
    });
    expect(result).toEqual({ stdout: "ready", stderr: "", exitCode: 0 });
  });

  it("does not pass companion, GitHub, or cloud secrets to a child", async () => {
    const names = ["DUSK_STUDIO_PAIRING_TOKEN", "DUSK_STUDIO_ENABLE_CAPABILITIES", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "AZURE_CLIENT_SECRET", "GOOGLE_API_KEY"];
    const fixtureValue = ["fixture", "credential", "value"].join("-");
    const result = await runBoundedProcess({ command: process.execPath, args: ["-e", `const names = ${JSON.stringify(names)}; process.stdout.write(JSON.stringify({ pathPresent: Boolean(process.env.PATH), secrets: Object.fromEntries(names.map((name) => [name, process.env[name] ?? null])) }));`], env: { ...process.env, ...Object.fromEntries(names.map((name) => [name, fixtureValue])) }, timeoutMs: 5_000, maxOutputBytes: 4_096 });
    expect(JSON.parse(result.stdout)).toEqual({ pathPresent: true, secrets: Object.fromEntries(names.map((name) => [name, null])) });
  });

  it("terminates a process that exceeds its timeout", async () => {
    const started = Date.now();
    const operation = runBoundedProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => undefined, 10000)"],
      timeoutMs: 100,
      maxOutputBytes: 4_096
    });
    await expect(operation).rejects.toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("terminates a process whose output exceeds the configured bound", async () => {
    const operation = runBoundedProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(100000))"],
      timeoutMs: 5_000,
      maxOutputBytes: 1_024
    });
    await expect(operation).rejects.toMatchObject({ reason: "output_limit" });
    await operation.catch((error: BoundedProcessError) => {
      expect(Buffer.byteLength(error.stdout) + Buffer.byteLength(error.stderr)).toBeLessThanOrEqual(1_024);
    });
  });

  it("returns a bounded failure for a nonzero exit", async () => {
    const operation = runBoundedProcess({
      command: process.execPath,
      args: ["-e", "process.stderr.write('failed'); process.exit(7)"],
      timeoutMs: 5_000,
      maxOutputBytes: 4_096
    });
    await expect(operation).rejects.toMatchObject({ reason: "exit", exitCode: 7, stderr: "failed" });
  });

  it("terminates descendants with the timed-out process", async () => {
    const parentScript = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 10000)'], { stdio: 'ignore' });",
      "process.stdout.write(String(child.pid) + '\\n');",
      "setInterval(() => undefined, 10000);"
    ].join(" ");
    let failure: BoundedProcessError | undefined;
    try {
      await runBoundedProcess({ command: process.execPath, args: ["-e", parentScript], timeoutMs: 200, maxOutputBytes: 4_096 });
    } catch (error) {
      failure = error as BoundedProcessError;
    }
    expect(failure?.reason).toBe("timeout");
    const descendantPid = Number(failure?.stdout.trim());
    expect(Number.isInteger(descendantPid)).toBe(true);
    for (let attempt = 0; attempt < 20 && isRunning(descendantPid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const stillRunning = isRunning(descendantPid);
    if (stillRunning) {
      try { process.kill(descendantPid, "SIGKILL"); } catch { /* already gone */ }
    }
    expect(stillRunning).toBe(false);
  });

  it("terminates active tracked process groups through the shutdown helper", async () => {
    const operation = runBoundedProcess({ command: process.execPath, args: ["-e", "setInterval(() => undefined, 10000)"], timeoutMs: 30_000, maxOutputBytes: 4_096 });
    const failure = operation.catch((error: BoundedProcessError) => error);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await terminateAllBoundedProcesses();
    const outcome = await failure;
    expect(outcome).toBeInstanceOf(BoundedProcessError);
    if (!(outcome instanceof BoundedProcessError)) throw new Error("Expected bounded process shutdown failure.");
    expect(outcome.reason).toSatisfy((reason: string) => reason === "signal" || reason === "exit");
  });
});
