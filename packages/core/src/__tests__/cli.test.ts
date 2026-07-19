import { describe, expect, it } from "vitest";
import {
  buildDuskDsCommandSet,
  buildDuskDsDeployCommandSet,
  quotePosixArg,
  quotePowerShellArg,
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

  it("separates Windows build commands from Ubuntu-24.04 VM tests", () => {
    const commands = buildDuskDsCommandSet({ parentDir: "", projectName: "native-demo", platform: "windows" });
    expect(commands.build).toContain("Set-Location -LiteralPath 'C:\\tmp\\dusk-studio-projects\\native-demo'");
    expect(commands.test).toContain("wsl -d Ubuntu-24.04 -- bash -lc");
    expect(commands.test).toContain("cd ''/mnt/c/tmp/dusk-studio-projects/native-demo'' && dusk-forge test");
    expect(commands.testEnvironment).toBe("Ubuntu-24.04 WSL");
  });

  it("uses the local generated root on POSIX", () => {
    const commands = buildDuskDsCommandSet({ parentDir: "examples", projectName: "native-demo", platform: "posix" });
    expect(commands.projectPath).toBe(".generated/examples/native-demo");
    expect(commands.testEnvironment).toBe("native Linux");
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
