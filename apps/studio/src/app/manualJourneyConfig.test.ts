import { describe, expect, it } from "vitest";
import {
  DUSKDS_FORGE_COMMIT,
  DUSKDS_MANUAL_TOOLS,
  buildManualForgeCommands,
  manualToolsFor
} from "./manualJourneyConfig";

describe("manual journey configuration", () => {
  it("pins Dusk Forge instead of installing from Git HEAD", () => {
    const forge = DUSKDS_MANUAL_TOOLS.find((tool) => tool.id === "dusk-forge");
    expect(forge?.installCommand?.posix).toContain(`--rev ${DUSKDS_FORGE_COMMIT}`);
    expect(forge?.installCommand?.windows).toContain("--locked");
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
  });

  it("creates distinct new-project and existing-project command lanes", () => {
    const fresh = buildManualForgeCommands({
      projectMode: "new",
      projectName: "counter-app",
      projectLabel: "",
      platform: "posix"
    });
    const existing = buildManualForgeCommands({
      projectMode: "existing",
      projectName: "",
      projectLabel: "existing-contract",
      platform: "windows"
    });
    expect(fresh.prepare).toContain("dusk-forge new counter-app");
    expect(fresh.prepare).toContain("rustup override set 1.94.0");
    expect(existing.prepare).toContain('Set-Location "existing-contract"');
    expect(existing.test).toContain("wsl -d Ubuntu-24.04");
  });
});
