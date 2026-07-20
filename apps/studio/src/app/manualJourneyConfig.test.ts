import { describe, expect, it } from "vitest";
import {
  DUSKDS_FORGE_COMMIT,
  DUSKDS_MANUAL_TOOLS,
  DUSKDS_PIN_TOOLCHAIN_COMMAND,
  W3SPER_CREATE_FILE_COMMAND,
  W3SPER_INSTALL_COMMAND,
  W3SPER_NODE_READ_SNIPPET,
  W3SPER_RUN_COMMAND,
  W3SPER_VERSION,
  W3SPER_WORKSPACE_COMMAND,
  manualToolsFor
} from "./manualJourneyConfig";

describe("manual journey configuration", () => {
  it("pins Dusk Forge instead of installing from Git HEAD", () => {
    const forge = DUSKDS_MANUAL_TOOLS.find((tool) => tool.id === "dusk-forge");
    expect(forge?.installCommand?.linux).toContain(`--rev ${DUSKDS_FORGE_COMMIT}`);
    expect(forge?.installCommand?.windows).not.toContain("--locked");
  });

  it("keeps required Setup tools separate from optional helpers", () => {
    const setup = manualToolsFor("setup");
    expect(setup.filter((tool) => tool.requirement === "required").map((tool) => tool.id)).toEqual([
      "git",
      "rustup",
      "rust-toolchain",
      "wasm-target",
      "rust-src",
      "dusk-forge"
    ]);
    expect(setup.some((tool) => tool.id === "wasm-opt")).toBe(false);
    expect(setup.find((tool) => tool.id === "wsl")?.requirement).toBe("conditional");
  });

  it("rejects Windows wasm-opt shims in the manual check", () => {
    const wasmOpt = DUSKDS_MANUAL_TOOLS.find((tool) => tool.id === "wasm-opt");
    expect(wasmOpt?.checkCommand.windows).toContain("CommandType -ne 'Application'");
    expect(wasmOpt?.checkCommand.windows).toContain("Source -notmatch '\\.exe$'");
  });

  it("writes the Windows toolchain pin as BOM-free UTF-8", () => {
    expect(DUSKDS_PIN_TOOLCHAIN_COMMAND.windows).toContain("Resolve-Path -LiteralPath '.\\rust-toolchain.toml' -ErrorAction Stop");
    expect(DUSKDS_PIN_TOOLCHAIN_COMMAND.windows).toContain("Get-Content -Raw -LiteralPath $toolchainPath -ErrorAction Stop");
    expect(DUSKDS_PIN_TOOLCHAIN_COMMAND.windows).toContain("[System.Text.UTF8Encoding]::new($false)");
    expect(DUSKDS_PIN_TOOLCHAIN_COMMAND.windows).toContain("Rust toolchain pin verification failed.");
    expect(DUSKDS_PIN_TOOLCHAIN_COMMAND.windows).not.toContain("Set-Content");
  });

  it("uses PowerShell-compatible fail-closed Rust and Cargo checks", () => {
    const rust = DUSKDS_MANUAL_TOOLS.find((tool) => tool.id === "rust-toolchain");
    expect(rust?.checkCommand.windows).toBe(
      "rustup run 1.94.0 rustc --version; if ($LASTEXITCODE -ne 0) { throw 'Rust 1.94.0 rustc check failed.' }; "
      + "rustup run 1.94.0 cargo --version; if ($LASTEXITCODE -ne 0) { throw 'Rust 1.94.0 Cargo check failed.' }"
    );
    expect(rust?.checkCommand.windows).not.toContain("&&");
    expect(rust?.checkCommand.windows).not.toContain("exit ");
    expect(rust?.checkCommand.linux).toContain("&&");
  });

  it("fails closed unless the Windows Forge command and exact Cargo receipt both pass", () => {
    const forge = DUSKDS_MANUAL_TOOLS.find((tool) => tool.id === "dusk-forge");
    expect(forge?.checkCommand.windows).toContain("$LASTEXITCODE -ne 0");
    expect(forge?.checkCommand.windows).toContain("Test-Path -LiteralPath $forgeReceipt -PathType Leaf");
    expect(forge?.checkCommand.windows).toContain("Select-String -LiteralPath $forgeReceipt");
    expect(forge?.checkCommand.windows).toContain("$forgeMatches.Count -eq 0");
    expect(forge?.checkCommand.windows).toContain("dusk-forge-cli\\s+v?0\\.1\\.0");
    expect(forge?.checkCommand.windows).toContain(DUSKDS_FORGE_COMMIT);
    expect(forge?.checkCommand.windows).toContain("$env:PATH = \"$forgeBin;$env:PATH\"");
    expect(forge?.checkCommand.linux).toContain('PATH="$forgeBin:$PATH"');
    expect(forge?.checkCommand.linux).toContain('"$forgeExe" --version');
  });

  it("provides an idempotent reviewed WSL check and repair lane", () => {
    const wsl = DUSKDS_MANUAL_TOOLS.find((tool) => tool.id === "wsl");
    expect(wsl?.checkCommand.windows).toContain("command -v make >/dev/null");
    expect(wsl?.checkCommand.windows).toContain("command -v jq >/dev/null");
    expect(wsl?.checkCommand.windows).toContain("command -v wasm-opt >/dev/null");
    expect(wsl?.checkCommand.windows).toContain("dusk-forge-cli[[:space:]]+v?0\\.1\\.0");
    expect(wsl?.checkCommand.windows).toContain(DUSKDS_FORGE_COMMIT);
    expect(wsl?.installCommand?.windows).toContain("wsl -d Ubuntu-24.04 -- true");
    expect(wsl?.installCommand?.windows).toContain("if ($LASTEXITCODE -ne 0) { wsl --install -d Ubuntu-24.04");
    expect(wsl?.installCommand?.windows).toContain(`--rev ${DUSKDS_FORGE_COMMIT}`);
  });

  it("never reuses an existing W3sper workspace or script and makes later commands self-contained", () => {
    expect(W3SPER_WORKSPACE_COMMAND.windows).toContain("if (Test-Path -LiteralPath 'duskds-w3sper-check')");
    expect(W3SPER_WORKSPACE_COMMAND.windows).not.toContain("-Force");
    expect(W3SPER_WORKSPACE_COMMAND.linux).toContain("if [ -e 'duskds-w3sper-check' ]");
    expect(W3SPER_WORKSPACE_COMMAND.linux).not.toContain("mkdir -p");
    expect(W3SPER_CREATE_FILE_COMMAND.windows).toContain("Set-Location -LiteralPath 'duskds-w3sper-check' -ErrorAction Stop");
    expect(W3SPER_CREATE_FILE_COMMAND.windows).not.toContain("-Force");
    expect(W3SPER_INSTALL_COMMAND.linux).toContain("cd 'duskds-w3sper-check'");
    expect(W3SPER_INSTALL_COMMAND.linux).toContain(`deno add --save-exact jsr:@dusk/w3sper@${W3SPER_VERSION}`);
    expect(W3SPER_RUN_COMMAND.windows).toContain("deno run --frozen --allow-net=testnet.nodes.dusk.network");
    expect(W3SPER_RUN_COMMAND.windows).toContain("$LASTEXITCODE -ne 0");
    expect(W3SPER_RUN_COMMAND.linux).toContain("deno run --frozen --allow-net=testnet.nodes.dusk.network");
    expect(W3SPER_RUN_COMMAND.linux).toMatch(/^\( set -e;/);
    expect(W3SPER_NODE_READ_SNIPPET).toContain("try {");
    expect(W3SPER_NODE_READ_SNIPPET).toContain("finally {");
    expect(W3SPER_NODE_READ_SNIPPET).toContain("await network.disconnect();");
  });
});
