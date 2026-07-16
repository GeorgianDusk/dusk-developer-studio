import { describe, expect, it } from "vitest";
import { createInitialJourneyProgress, invalidateJourneyFrom, recordJourneyEvidence } from "./journeyProgress";

describe("journey invalidation", () => {
  it("clears the changed step and every downstream claim", () => {
    let state = createInitialJourneyProgress();
    state = recordJourneyEvidence(state, "evm", "setup", ["evm-rpc-chain", "evm-wallet-chain", "evm-wallet-account", "evm-balance-read"]);
    state = recordJourneyEvidence(state, "evm", "access", ["evm-positive-balance"]);
    state = recordJourneyEvidence(state, "evm", "build", ["evm-starter-structure", "evm-build-test-attestation"]);
    const invalidated = invalidateJourneyFrom(state, "evm", "access");
    expect(invalidated.paths.evm.setup.status).toBe("verified");
    expect(invalidated.paths.evm.access).toEqual({ status: "ready", evidence: [] });
    expect(invalidated.paths.evm.build).toEqual({ status: "not-started", evidence: [] });
    expect(invalidated.paths.evm.inspect).toEqual({ status: "not-started", evidence: [] });
  });
});
