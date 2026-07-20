import { describe, expect, it } from "vitest";
import { isCompanionHealth, isPairingResult, isPreflightResult, isScaffoldEvidence } from "./responseSchemas";
import {
  DUSKDS_FORGE_COMMIT,
  DUSKDS_TEMPLATE_ID,
  DUSKDS_TEMPLATE_LOCK_SHA256
} from "./manualJourneyConfig";

const templateReceipt = {
  template: DUSKDS_TEMPLATE_ID,
  templateSource: "https://github.com/dusk-network/forge",
  templateRevision: DUSKDS_FORGE_COMMIT,
  templateLockSha256: DUSKDS_TEMPLATE_LOCK_SHA256
};

describe("companion response schemas", () => {
  it("accepts the bounded production shapes", () => {
    expect(isCompanionHealth({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: false })).toBe(true);
    expect(isCompanionHealth({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: { product: "Dusk Developer Studio", version: "1.2.3", commit: "a".repeat(40), channel: "npm" } })).toBe(true);
    expect(isPairingResult({ ok: true, paired: true, expiresInSeconds: 3600 })).toBe(true);
    expect(isPreflightResult({ ok: true, checkedAt: new Date().toISOString(), path: "duskds", tools: [] })).toBe(true);
    expect(isScaffoldEvidence({
      ok: true,
      projectName: "starter",
      projectPath: "C:\\managed\\starter",
      structureVerified: true,
      files: ["src/lib.rs"],
      runtimeOs: "windows",
      rustToolchain: "1.94.0",
      ...templateReceipt
    })).toBe(true);
    expect(isScaffoldEvidence({
      ok: true,
      projectName: "starter",
      projectPath: "/managed/starter",
      structureVerified: true,
      files: ["Cargo.toml"],
      runtimeOs: "linux",
      rustToolchain: "1.94.0",
      ...templateReceipt
    })).toBe(true);
    expect(isScaffoldEvidence({
      ok: true,
      projectName: "starter",
      projectPath: "/Users/tester/starter",
      structureVerified: true,
      files: ["Cargo.toml"],
      runtimeOs: "macos",
      rustToolchain: "1.94.0",
      ...templateReceipt
    })).toBe(true);
  });

  it("rejects oversized, malformed, and capability-confused shapes", () => {
    expect(isCompanionHealth({ ok: true, service: "x".repeat(65), paired: true, capabilitiesEnabled: "yes" })).toBe(false);
    expect(isCompanionHealth({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: { product: "Dusk Developer Studio", version: "1.2.3", commit: "a".repeat(40), channel: "preview" } })).toBe(false);
    expect(isPairingResult({ ok: true, paired: true, expiresInSeconds: -1 })).toBe(false);
    expect(isPreflightResult({ ok: true, checkedAt: "now", path: "mainnet", tools: [] })).toBe(false);
    expect(isScaffoldEvidence({ ok: true, projectName: "starter", projectPath: "relative/starter", structureVerified: true, files: ["src/lib.rs"] })).toBe(false);
    expect(isScaffoldEvidence({ ok: true, projectName: "starter", projectPath: "/managed/starter", structureVerified: true, files: Array.from({ length: 257 }, () => "a") })).toBe(false);
    expect(isScaffoldEvidence({
      ok: true,
      projectName: "starter",
      projectPath: "/managed/starter",
      structureVerified: true,
      files: ["Cargo.toml"],
      runtimeOs: "posix"
    })).toBe(false);
    expect(isScaffoldEvidence({
      ok: true,
      projectName: "starter",
      projectPath: "C:\\managed\\starter",
      structureVerified: true,
      files: ["Cargo.toml"],
      runtimeOs: "macos",
      rustToolchain: "1.94.0",
      ...templateReceipt
    })).toBe(false);
  });
});
