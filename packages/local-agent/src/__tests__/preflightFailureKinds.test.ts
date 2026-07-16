import { describe, expect, it, vi } from "vitest";
import { runPreflightAsync } from "../commands/preflight";
import { BoundedProcessError, type BoundedProcessOptions } from "../commands/runBoundedProcess";

function logicalCommand(options: BoundedProcessOptions): string {
  return options.command === "cmd.exe" ? options.args[3] : options.command;
}

describe("preflight failure classification", () => {
  it("distinguishes a missing executable from a timeout", async () => {
    const missing = vi.fn(async (options: BoundedProcessOptions) => {
      if (logicalCommand(options) === "forge") throw new BoundedProcessError("failed", "exit", "", "forge is not recognized", 1);
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });
    const missingResult = await runPreflightAsync("evm", { runProcess: missing });
    expect(missingResult.tools.find((tool) => tool.command === "forge")?.failureKind).toBe("missing");

    const timedOut = vi.fn(async (options: BoundedProcessOptions) => {
      if (logicalCommand(options) === "forge") throw new BoundedProcessError("timed out", "timeout", "", "", null);
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });
    const timeoutResult = await runPreflightAsync("evm", { runProcess: timedOut });
    expect(timeoutResult.tools.find((tool) => tool.command === "forge")?.failureKind).toBe("timeout");
  });
});
