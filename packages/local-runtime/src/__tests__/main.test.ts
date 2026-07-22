// @vitest-environment node

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  describeLocalRuntimeListenFailure,
  localBrowserPairingInstruction,
  localRuntimeStopInstruction,
  parseWindowsNetstatListeningEndpoints,
  resolveDuskDsProjectRoot,
  resolveLocalBrowserLaunch,
  resolveLocalRuntimeCliMode
} from "../main";

describe("local npm runtime CLI mode", () => {
  it("defaults to interactive mode", () => {
    expect(resolveLocalRuntimeCliMode([])).toEqual({
      openBrowser: true,
      lifecycleSelfTest: false
    });
  });

  it("forces a browser-free mode for lifecycle verification", () => {
    expect(resolveLocalRuntimeCliMode(["--lifecycle-self-test"])).toEqual({
      openBrowser: false,
      lifecycleSelfTest: true
    });
    expect(resolveLocalRuntimeCliMode(["--lifecycle-self-test", "--no-open"])).toEqual({
      openBrowser: false,
      lifecycleSelfTest: true
    });
  });

  it("rejects unknown, repeated, and mode-escalation arguments", () => {
    expect(() => resolveLocalRuntimeCliMode(["--unknown"])).toThrow(/Unsupported argument/);
    expect(() => resolveLocalRuntimeCliMode(["--no-open", "--no-open"])).toThrow(/must not be repeated/);
    expect(() => resolveLocalRuntimeCliMode(["--enable-local-actions"])).toThrow(/Unsupported argument/);
  });

  it("explains the Windows npx shutdown confirmation without burdening other platforms", () => {
    expect(localRuntimeStopInstruction("win32")).toContain('Terminate batch job (Y/N)?');
    expect(localRuntimeStopInstruction("win32")).toContain("type Y and press Enter");
    expect(localRuntimeStopInstruction("linux")).toBe(
      "Press Ctrl+C to stop. Projects remain under the managed DuskDS project root."
    );
    expect(localRuntimeStopInstruction("darwin")).not.toContain("Terminate batch job");
  });

  it("explains how to pair the intended browser profile", () => {
    expect(localBrowserPairingInstruction(true)).toContain("this launch pairs one browser profile");
    expect(localBrowserPairingInstruction(true)).toContain("rerun with --no-open");
    expect(localBrowserPairingInstruction(false)).toContain("one browser profile you want to pair");
    expect(localBrowserPairingInstruction(false)).toContain("within five minutes");
    expect(localBrowserPairingInstruction(false)).toContain("http://127.0.0.1:5173/#companion");
  });

  it("turns fixed-port conflicts into actionable, cleanup-aware recovery", () => {
    const occupied = Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:5173"), {
      code: "EADDRINUSE"
    });
    const described = describeLocalRuntimeListenFailure(occupied, 5173);
    expect(described.message).toContain("127.0.0.1:5173 is already in use");
    expect(described.message).toContain("confirm the port is free");
    expect(described.message).toContain("rerun the same command");
    expect(described.message).toContain("partially started Studio service was stopped");
    expect(described.message).not.toContain("EADDRINUSE");
    expect(describeLocalRuntimeListenFailure(occupied, 8788).message).toContain(
      "127.0.0.1:8788 is already in use"
    );

    const unrelated = new Error("certificate verification failed");
    expect(describeLocalRuntimeListenFailure(unrelated, 8788)).toBe(unrelated);
  });

  it("uses one managed DuskDS root and supports only explicit safe absolute overrides", () => {
    const managed = path.resolve("runtime-projects");
    const override = process.platform === "win32" ? "C:\\tmp\\short-duskds-root" : path.join(managed, "short-duskds-root");
    expect(resolveDuskDsProjectRoot(managed, "")).toBe(path.join(managed, "duskds"));
    expect(resolveDuskDsProjectRoot(managed, override)).toBe(path.resolve(override));
    expect(() => resolveDuskDsProjectRoot(managed, "relative-root")).toThrow(/normal absolute local path/);
    expect(() => resolveDuskDsProjectRoot(managed, path.parse(managed).root)).toThrow(/cannot be a filesystem root/);
    if (process.platform === "win32") {
      expect(() => resolveDuskDsProjectRoot(managed, "\\root-relative")).toThrow(/normal absolute local path/);
      expect(() => resolveDuskDsProjectRoot(managed, "/root-relative")).toThrow(/normal absolute local path/);
    }
    expect(() => resolveDuskDsProjectRoot(managed, path.resolve(managed, "x".repeat(1_100))))
      .toThrow(/1,024 characters or fewer/);
    expect(() => resolveDuskDsProjectRoot("m".repeat(1_100), ""))
      .toThrow(/1,024 characters or fewer/);
  });

  it("parses locale-independent Windows netstat listener rows for the exact owner", () => {
    const output = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:8788         0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:53000        203.0.113.5:443         ESTABLISHED     4242",
      "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900"
    ].join("\r\n");
    expect(parseWindowsNetstatListeningEndpoints(output, 4242)).toEqual([
      "127.0.0.1:5173",
      "127.0.0.1:8788"
    ]);
    expect(() => parseWindowsNetstatListeningEndpoints("TCP broken", 4242)).toThrow(
      /malformed Windows socket row/
    );
    expect(() => parseWindowsNetstatListeningEndpoints(
      "TCP 127.0.0.1:5173 0.0.0.0:0 LISTENING 999999999999",
      4242
    )).toThrow(/malformed Windows socket PID/);
  });

  it("never selects a planted explorer executable or inherits the launch project as browser cwd", async () => {
    if (process.platform !== "win32") return;
    const launchProject = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-browser-plant-"));
    const studioRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-browser-owned-"));
    try {
      await fs.writeFile(path.join(launchProject, "explorer.exe"), "planted");
      const launch = resolveLocalBrowserLaunch(
        studioRoot,
        {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          PATH: launchProject
        },
        "win32",
        launchProject
      );
      expect(path.basename(launch.command).toLowerCase()).toBe("explorer.exe");
      expect(path.dirname(launch.command).toLowerCase()).toBe(
        path.normalize(process.env.SystemRoot as string).toLowerCase()
      );
      expect(launch.command.toLowerCase()).not.toBe(path.join(launchProject, "explorer.exe").toLowerCase());
      expect(launch.cwd.toLowerCase()).toBe((await fs.realpath(studioRoot)).toLowerCase());
      expect(launch.cwd.toLowerCase()).not.toBe(launchProject.toLowerCase());
    } finally {
      await Promise.all([
        fs.rm(launchProject, { recursive: true, force: true }),
        fs.rm(studioRoot, { recursive: true, force: true })
      ]);
    }
  });
});
