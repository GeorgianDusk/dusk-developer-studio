import { describe, expect, it } from "vitest";
import {
  buildDuskDsDeployCommandSet,
  quotePosixArg,
  quotePowerShellArg,
  resolveDuskDsProjectParent,
  resolveDuskDsProjectPath,
  windowsPathToWsl
} from "../index";

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

  it("resolves platform project paths without emitting an unsafe command sequence", () => {
    expect(resolveDuskDsProjectPath("", "native-demo", "windows"))
      .toBe("C:\\tmp\\dusk-studio-projects\\native-demo");
    expect(resolveDuskDsProjectPath("examples", "native-demo", "posix"))
      .toBe(".generated/examples/native-demo");
  });

  it("preserves Windows and POSIX filesystem roots when resolving and reversing project paths", () => {
    const windowsProject = resolveDuskDsProjectPath("C:\\", "native-demo", "windows");
    const posixProject = resolveDuskDsProjectPath("/", "native-demo", "posix");

    expect(windowsProject).toBe("C:\\native-demo");
    expect(resolveDuskDsProjectParent(windowsProject, "native-demo", "windows")).toBe("C:\\");
    expect(posixProject).toBe("/native-demo");
    expect(resolveDuskDsProjectParent(posixProject, "native-demo", "posix")).toBe("/");
  });

  it("fails closed instead of deriving a parent from an unrelated project path", () => {
    expect(() => resolveDuskDsProjectParent("C:\\other", "native-demo", "windows"))
      .toThrow("expected project folder");
    expect(() => resolveDuskDsProjectParent("/other", "native-demo", "posix"))
      .toThrow("expected project folder");
  });

  it("builds a non-executable-by-default POSIX deploy template", () => {
    const commands = buildDuskDsDeployCommandSet("posix");
    expect(commands.prerequisiteChecks).toBe([
      "rusk-wallet --version",
      "rusk-wallet --network testnet settings",
      "rusk-wallet --network testnet contract-deploy --help"
    ].join("\n"));
    expect(commands.deployTemplate).toContain('rusk-wallet --network testnet contract-deploy \\');
    expect(commands.deployTemplate).toContain('--address "<PUBLIC_TESTNET_ADDRESS>" \\');
    expect(commands.deployTemplate).toContain('--code "<PATH_TO_WASM_CONTRACT>" \\');
    expect(commands.deployTemplate).toContain('--deploy-nonce "<UNUSED_NONCE>"');
    expect(commands.deployTemplate).not.toMatch(/--init-args|--gas-limit|--gas-price/);
    expect(commands.deployTemplate).not.toMatch(/mnemonic|private.?key|password/i);
  });

  it("uses PowerShell continuations without filling wallet or fee values", () => {
    const commands = buildDuskDsDeployCommandSet("windows");
    expect(commands.prerequisiteChecks).toContain("\r\n");
    expect(commands.deployTemplate).toContain("rusk-wallet --network testnet contract-deploy `\r\n");
    expect(commands.deployTemplate.match(/--address/g)).toHaveLength(1);
    expect(commands.deployTemplate).not.toMatch(/--profile|--password/);
  });
});
