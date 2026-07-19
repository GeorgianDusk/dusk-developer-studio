import { describe, expect, it } from "vitest";
import { createInitialJourneyProgress, invalidateJourneyFrom, recordJourneyEvidence, removeJourneyEvidence } from "./journeyProgress";

describe("journey invalidation", () => {
  it("clears the changed step and every downstream claim", () => {
    let state = createInitialJourneyProgress();
    state = recordJourneyEvidence(state, "evm", "setup", ["evm-rpc-chain", "evm-wallet-chain", "evm-wallet-account", "evm-balance-read"]);
    state = recordJourneyEvidence(state, "evm", "access", ["evm-positive-balance"]);
    state = recordJourneyEvidence(state, "evm", "build", ["evm-starter-structure", "evm-build-test-attestation"]);
    const invalidated = invalidateJourneyFrom(state, "evm", "access");
    expect(invalidated.paths.evm.setup.status).toBe("confirmed-manually");
    expect(invalidated.paths.evm.access).toEqual({ status: "ready", evidence: [], evidenceEntries: [] });
    expect(invalidated.paths.evm.build).toEqual({ status: "not-started", evidence: [], evidenceEntries: [] });
    expect(invalidated.paths.evm.inspect).toEqual({ status: "not-started", evidence: [], evidenceEntries: [] });
  });

  it("removes a revoked confirmation and clears its downstream claims", () => {
    let state = createInitialJourneyProgress();
    state = recordJourneyEvidence(state, "duskds", "setup", ["duskds-required-preflight"], { method: "manual" });
    state = recordJourneyEvidence(state, "duskds", "access", ["duskds-node-read-attestation"], { method: "manual" });

    const next = removeJourneyEvidence(state, "duskds", "setup", ["duskds-required-preflight"]);

    expect(next.paths.duskds.setup.evidence).toEqual([]);
    expect(next.paths.duskds.setup.status).toBe("ready");
    expect(next.paths.duskds.access.evidence).toEqual([]);
    expect(next.paths.duskds.access.status).toBe("not-started");
  });

  it("preserves independent Inspect receipts when one confirmation is revoked", () => {
    let state = createInitialJourneyProgress();
    state = recordJourneyEvidence(state, "duskds", "inspect", [
      "duskds-inspect-latest-block",
      "duskds-inspect-artifact-revision",
      "duskds-inspect-driver-availability",
      "duskds-inspect-driver-schema",
      "duskds-inspect-driver-encode",
      "duskds-inspect-driver-decode"
    ], { method: "manual" });

    const next = removeJourneyEvidence(state, "duskds", "inspect", ["duskds-inspect-driver-schema"]);

    expect(next.paths.duskds.inspect.evidence).not.toContain("duskds-inspect-driver-schema");
    expect(next.paths.duskds.inspect.evidence).toContain("duskds-inspect-driver-availability");
    expect(next.paths.duskds.inspect.evidence).toContain("duskds-inspect-driver-encode");
    expect(next.paths.duskds.inspect.status).not.toBe("confirmed-manually");
  });
});
