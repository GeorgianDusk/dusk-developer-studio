import { describe, expect, it } from "vitest";
import { buildDuskDsCommandSet, quotePosixArg, quotePowerShellArg, windowsPathToWsl } from "../index";

describe("command generation", () => {
  it("quotes hostile shell metacharacters as one POSIX argument", () => {
    expect(quotePosixArg("demo'; rm -rf x")).toBe("'demo'\"'\"'; rm -rf x'");
  });

  it("quotes PowerShell apostrophes without interpolation", () => {
    expect(quotePowerShellArg("C:\\work\\it's safe")).toBe("'C:\\work\\it''s safe'");
  });

  it("converts absolute Windows drive paths to WSL paths", () => {
    expect(windowsPathToWsl("C:\\tmp\\dusk studio")).toBe("/mnt/c/tmp/dusk studio");
    expect(() => windowsPathToWsl("\\\\server\\share")).toThrow("absolute Windows drive path");
  });

  it("separates Windows build commands from Ubuntu VM tests", () => {
    const commands = buildDuskDsCommandSet({ parentDir: "", projectName: "native-demo", platform: "windows" });
    expect(commands.build).toContain("Set-Location -LiteralPath 'C:\\tmp\\dusk-studio-projects\\native-demo'");
    expect(commands.test).toContain("wsl -d Ubuntu");
    expect(commands.test).toContain("cd '/mnt/c/tmp/dusk-studio-projects/native-demo'");
    expect(commands.testEnvironment).toBe("Ubuntu WSL");
  });

  it("uses the local generated root on POSIX", () => {
    const commands = buildDuskDsCommandSet({ parentDir: "examples", projectName: "native-demo", platform: "posix" });
    expect(commands.projectPath).toBe(".generated/examples/native-demo");
    expect(commands.testEnvironment).toBe("native POSIX");
  });
});
