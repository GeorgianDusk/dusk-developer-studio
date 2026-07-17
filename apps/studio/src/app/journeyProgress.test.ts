import { describe, expect, it } from "vitest";
import {
  blockJourneyStep,
  countVerifiedSteps,
  createInitialJourneyProgress,
  getEvidenceProvenanceCounts,
  getJourneyCompletionCounts,
  parseJourneyProgress,
  recordJourneyEvidence,
  resumeJourneyStep,
  skipJourneyStep
} from "./journeyProgress";

describe("journey progress", () => {
  it("separates automatic passes from manual confirmations while unlocking the next step", () => {
    let state = createInitialJourneyProgress();
    expect(state.paths.evm.setup.status).toBe("ready");
    expect(state.paths.evm.access.status).toBe("not-started");
    state = recordJourneyEvidence(
      state,
      "evm",
      "setup",
      ["evm-rpc-chain", "evm-wallet-chain", "evm-wallet-account", "evm-balance-read"],
      {
        method: "automatic",
        observedAt: "2026-07-14T10:00:00.000Z",
        metadata: { source: "browser-check", platform: "browser", checkCount: 4 }
      }
    );
    expect(state.paths.evm.setup.status).toBe("passed-automatically");
    expect(state.paths.evm.access.status).toBe("ready");
    expect(countVerifiedSteps(state, "evm")).toBe(1);
    expect(getJourneyCompletionCounts(state, "evm")).toEqual({
      completed: 1,
      automatic: 1,
      manual: 0,
      skipped: 0,
      total: 4
    });
    expect(getEvidenceProvenanceCounts(state, "evm")).toEqual({ automatic: 4, manual: 0, total: 4 });

    state = recordJourneyEvidence(state, "evm", "access", ["evm-positive-balance"]);
    expect(state.paths.evm.access.status).toBe("confirmed-manually");
    expect(state.paths.evm.access.evidenceEntries[0]).toMatchObject({
      method: "manual",
      status: "confirmed-manually",
      metadata: { source: "manual-confirmation" }
    });
    expect(getJourneyCompletionCounts(state, "evm")).toMatchObject({ completed: 2, automatic: 1, manual: 1 });
  });

  it("uses manual completion semantics when a step combines automatic and manual evidence", () => {
    let state = createInitialJourneyProgress();
    state = recordJourneyEvidence(
      state,
      "duskds",
      "build",
      ["duskds-starter-structure"],
      { method: "automatic", observedAt: "2026-07-14T10:00:00.000Z", metadata: { source: "companion" } }
    );
    state = recordJourneyEvidence(
      state,
      "duskds",
      "build",
      ["duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { method: "manual", observedAt: "2026-07-14T10:05:00.000Z" }
    );
    expect(state.paths.duskds.build.status).toBe("confirmed-manually");
    expect(getEvidenceProvenanceCounts(state, "duskds")).toEqual({ automatic: 1, manual: 2, total: 3 });
  });

  it("migrates legacy browser records without treating attestations as automatic checks", () => {
    const parsed = parseJourneyProgress(JSON.stringify({
      version: 1,
      paths: {
        evm: {},
        duskds: {
          access: {
            status: "verified",
            evidence: ["duskds-node-read-attestation", "0xsecret"],
            blocker: "not-safe",
            checkedAt: "2026-07-14T10:00:00.000Z"
          }
        }
      }
    }));
    expect(parsed.paths.duskds.access.status).toBe("confirmed-manually");
    expect(parsed.paths.duskds.access.evidence).toEqual(["duskds-node-read-attestation"]);
    expect(parsed.paths.duskds.access.evidenceEntries).toEqual([{
      code: "duskds-node-read-attestation",
      method: "manual",
      status: "confirmed-manually",
      observedAt: "2026-07-14T10:00:00.000Z",
      metadata: { source: "legacy-storage" }
    }]);
    expect(parsed.paths.duskds.access.blocker).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("0xsecret");
  });

  it("bounds metadata and removes values that could carry sensitive output", () => {
    const parsed = parseJourneyProgress(JSON.stringify({
      version: 1,
      paths: {
        evm: {},
        duskds: {
          setup: {
            status: "passed-automatically",
            evidence: ["duskds-required-preflight"],
            evidenceEntries: [{
              code: "duskds-required-preflight",
              method: "automatic",
              status: "passed-automatically",
              observedAt: "2026-07-14T10:00:00.000Z",
              metadata: {
                source: "companion",
                tool: "rustc",
                version: "1.94.0",
                revision: "ABCDEF1234567",
                checkCount: 101,
                blockHeight: 98765,
                blockHash: `0x${"a".repeat(64)}`,
                endpoint: "https://nodes.dusk.network/on/driver:secret?token=private#fragment",
                account: "0xsecret",
                path: "C:\\Users\\private"
              }
            }]
          }
        }
      }
    }));
    expect(parsed.paths.duskds.setup.evidenceEntries[0].metadata).toEqual({
      source: "companion",
      tool: "rustc",
      version: "1.94.0",
      revision: "abcdef1234567",
      blockHeight: 98765,
      blockHash: `0x${"a".repeat(64)}`,
      endpoint: "https://nodes.dusk.network"
    });
    expect(JSON.stringify(parsed)).not.toContain("0xsecret");
    expect(JSON.stringify(parsed)).not.toContain("Users");
    expect(JSON.stringify(parsed)).not.toContain("token");
    expect(JSON.stringify(parsed)).not.toContain("driver");
  });

  it("does not promote the combined legacy Inspect attestation into new evidence", () => {
    const parsed = parseJourneyProgress(JSON.stringify({
      version: 1,
      paths: {
        evm: {},
        duskds: {
          inspect: {
            status: "verified",
            evidence: ["duskds-read-inspection-attestation"],
            checkedAt: "2026-07-14T10:00:00.000Z"
          }
        }
      }
    }));
    expect(parsed.paths.duskds.inspect.status).not.toBe("confirmed-manually");
    expect(parsed.paths.duskds.inspect.evidence).toEqual([]);
    expect(parsed.paths.duskds.inspect.evidenceEntries).toEqual([]);
  });

  it("keeps only bounded driver observation context", () => {
    const state = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "inspect",
      ["duskds-inspect-driver-encode"],
      {
        method: "manual",
        observedAt: "2026-07-14T10:00:00.000Z",
        metadata: {
          source: "manual-confirmation",
          tool: "rpc",
          revision: "a".repeat(40),
          endpoint: "https://testnet.nodes.dusk.network/on/driver:secret?token=private",
          contractId: `0x${"B".repeat(64)}`,
          functionName: "increment_by",
          responseSha256: "C".repeat(64)
        }
      }
    );
    expect(state.paths.duskds.inspect.evidenceEntries[0].metadata).toEqual({
      source: "manual-confirmation",
      tool: "rpc",
      revision: "a".repeat(40),
      endpoint: "https://testnet.nodes.dusk.network",
      contractId: "b".repeat(64),
      functionName: "increment_by",
      responseSha256: "c".repeat(64)
    });
    expect(JSON.stringify(state)).not.toContain("token");
    expect(JSON.stringify(state)).not.toContain("driver:secret");
  });

  it("keeps bounded Build artifact receipts without storing paths", () => {
    const state = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "build",
      ["duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      {
        method: "automatic",
        observedAt: "2026-07-14T10:00:00.000Z",
        metadata: {
          source: "companion",
          contractArtifactName: "contract.wasm",
          contractArtifactSha256: "A".repeat(64),
          contractArtifactSizeBytes: 12345,
          dataDriverArtifactName: "data_driver.wasm",
          dataDriverArtifactSha256: "b".repeat(64),
          dataDriverArtifactSizeBytes: 54321,
          testEnvironment: "wsl-ubuntu-24.04",
          testsPassed: true
        }
      }
    );
    expect(state.paths.duskds.build.evidenceEntries[0].metadata).toMatchObject({
      contractArtifactName: "contract.wasm",
      contractArtifactSha256: "a".repeat(64),
      contractArtifactSizeBytes: 12345,
      dataDriverArtifactName: "data_driver.wasm",
      dataDriverArtifactSha256: "b".repeat(64),
      dataDriverArtifactSizeBytes: 54321,
      testEnvironment: "wsl-ubuntu-24.04",
      testsPassed: true
    });
    const parsed = parseJourneyProgress(JSON.stringify({
      version: 1,
      paths: {
        evm: {},
        duskds: {
          build: {
            status: "ready",
            evidence: state.paths.duskds.build.evidence,
            evidenceEntries: [{
              ...state.paths.duskds.build.evidenceEntries[0],
              metadata: {
                ...state.paths.duskds.build.evidenceEntries[0].metadata,
                contractArtifactName: "C:\\secret\\contract.wasm",
                dataDriverArtifactSizeBytes: 200 * 1024 * 1024
              }
            }]
          }
        }
      }
    }));
    expect(parsed.paths.duskds.build.evidenceEntries[0].metadata?.contractArtifactName).toBeUndefined();
    expect(parsed.paths.duskds.build.evidenceEntries[0].metadata?.dataDriverArtifactSizeBytes).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  it("humanizes skipped state and supports resuming without deleting evidence", () => {
    let state = blockJourneyStep(createInitialJourneyProgress(), "evm", "setup", "no-wallet");
    expect(state.paths.evm.setup).toMatchObject({ status: "blocked", blocker: "no-wallet" });
    state = skipJourneyStep(state, "evm", "setup", "no-wallet");
    expect(state.paths.evm.setup.status).toBe("skipped");
    expect(state.paths.evm.access.status).toBe("ready");
    state = resumeJourneyStep(state, "evm", "setup");
    expect(state.paths.evm.setup).toMatchObject({ status: "ready", evidence: [], evidenceEntries: [] });
    expect(state.paths.evm.setup.blocker).toBeUndefined();
    expect(state.paths.evm.access.status).toBe("not-started");
  });
});
