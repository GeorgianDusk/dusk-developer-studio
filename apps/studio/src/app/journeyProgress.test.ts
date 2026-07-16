import { describe, expect, it } from "vitest";
import {
  blockJourneyStep,
  countVerifiedSteps,
  createInitialJourneyProgress,
  parseJourneyProgress,
  recordJourneyEvidence,
  skipJourneyStep
} from "./journeyProgress";

describe("journey progress", () => {
  it("unlocks steps only after evidence verifies the previous step", () => {
    let state = createInitialJourneyProgress();
    expect(state.paths.evm.setup.status).toBe("ready");
    expect(state.paths.evm.access.status).toBe("not-started");
    state = recordJourneyEvidence(state, "evm", "setup", ["evm-rpc-chain", "evm-wallet-chain", "evm-wallet-account", "evm-balance-read"]);
    expect(state.paths.evm.setup.status).toBe("verified");
    expect(state.paths.evm.access.status).toBe("ready");
    expect(countVerifiedSteps(state, "evm")).toBe(1);
  });

  it("stores only allowlisted evidence and blocker codes", () => {
    const parsed = parseJourneyProgress(JSON.stringify({
      version: 1,
      paths: {
        evm: { setup: { status: "verified", evidence: ["evm-rpc-chain", "0xsecret"], blocker: "not-safe", checkedAt: "2026-07-14T10:00:00.000Z" } },
        duskds: {}
      }
    }));
    expect(parsed.paths.evm.setup.evidence).toEqual(["evm-rpc-chain"]);
    expect(parsed.paths.evm.setup.blocker).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("0xsecret");
  });

  it("preserves explicit blocked and skipped states", () => {
    let state = blockJourneyStep(createInitialJourneyProgress(), "evm", "setup", "no-wallet");
    expect(state.paths.evm.setup).toMatchObject({ status: "blocked", blocker: "no-wallet" });
    state = skipJourneyStep(state, "evm", "setup", "no-wallet");
    expect(state.paths.evm.setup.status).toBe("skipped-with-reason");
    expect(state.paths.evm.access.status).toBe("ready");
  });
});
