// @vitest-environment node

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  parseWindowsNetstatListeningEndpoints,
  resolveDuskDsProjectRoot,
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

  it("uses one managed DuskDS root and supports only explicit safe absolute overrides", () => {
    const managed = path.resolve("runtime-projects");
    const override = path.join(managed, "short-duskds-root");
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
});
