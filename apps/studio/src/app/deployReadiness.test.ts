import { describe, expect, it } from "vitest";
import {
  createInitialJourneyProgress,
  recordJourneyEvidence,
  type JourneyStatus,
  type StepRoute
} from "./journeyProgress";
import { getDuskDsDeployReadiness } from "./deployReadiness";

function recordPreDeployEvidence(observedAt?: string) {
  const revision = "a".repeat(40);
  let state = createInitialJourneyProgress();
  state = recordJourneyEvidence(
    state,
    "duskds",
    "setup",
    ["duskds-required-preflight"],
    { observedAt }
  );
  state = recordJourneyEvidence(
    state,
    "duskds",
    "access",
    ["duskds-node-read-attestation"],
    { observedAt }
  );
  state = recordJourneyEvidence(state, "duskds", "build", [
    "duskds-starter-structure",
    "duskds-build-artifact-attestation",
    "duskds-vm-test-attestation"
  ], { observedAt, metadata: { revision } });
  state = recordJourneyEvidence(
    state,
    "duskds",
    "inspect",
    ["duskds-inspect-artifact-revision"],
    { observedAt, metadata: { revision } }
  );
  return state;
}

describe("DuskDS deploy readiness", () => {
  it("points a new journey to the first missing prerequisite", () => {
    const readiness = getDuskDsDeployReadiness(createInitialJourneyProgress());
    expect(readiness).toMatchObject({
      evidenceReady: false,
      readyCount: 0,
      requiredCount: 4,
      nextRoute: "setup"
    });
    expect(readiness.checks.at(-1)).toMatchObject({ id: "wallet", state: "manual-check" });
  });

  it("becomes ready before post-deploy driver evidence exists", () => {
    const readiness = getDuskDsDeployReadiness(recordPreDeployEvidence());
    expect(readiness).toMatchObject({
      evidenceReady: true,
      readyCount: 4,
      requiredCount: 4
    });
    expect(readiness.nextRoute).toBeUndefined();
  });

  it("does not confuse partial Build evidence with deploy readiness", () => {
    let state = recordPreDeployEvidence();
    state.paths.duskds.build.evidence = ["duskds-starter-structure"];
    state.paths.duskds.build.evidenceEntries = state.paths.duskds.build.evidenceEntries
      .filter((entry) => entry.code === "duskds-starter-structure");
    const readiness = getDuskDsDeployReadiness(state);
    expect(readiness.evidenceReady).toBe(false);
    expect(readiness.nextRoute).toBe("build");
  });

  it.each([
    ["setup", "blocked"],
    ["access", "skipped"],
    ["build", "skipped-with-reason"],
    ["build", "ready"]
  ] satisfies [StepRoute, JourneyStatus][])(
    "rejects %s evidence when the step status is %s",
    (route, status) => {
      const state = recordPreDeployEvidence();
      state.paths.duskds[route].status = status;
      const readiness = getDuskDsDeployReadiness(state);
      expect(readiness.evidenceReady).toBe(false);
      expect(readiness.nextRoute).toBe(route);
      expect(readiness.checks.find((check) => check.route === route)).toMatchObject({
        state: "needs-evidence"
      });
    }
  );

  it("rejects a completed prerequisite that still carries a blocker", () => {
    const state = recordPreDeployEvidence();
    state.paths.duskds.setup.blocker = "toolchain-incomplete";
    const readiness = getDuskDsDeployReadiness(state);
    expect(readiness.evidenceReady).toBe(false);
    expect(readiness.nextRoute).toBe("setup");
  });

  it("rejects an Inspect source identity that differs from the built artifacts", () => {
    const state = recordPreDeployEvidence();
    state.paths.duskds.inspect.evidenceEntries[0].metadata = { revision: "b".repeat(40) };
    const readiness = getDuskDsDeployReadiness(state);
    expect(readiness.evidenceReady).toBe(false);
    expect(readiness.nextRoute).toBe("inspect");
  });

  it("expires a Testnet access observation after 24 hours and exposes its evidence window", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const state = recordPreDeployEvidence(now.toISOString());
    state.paths.duskds.access.evidenceEntries[0].observedAt = "2026-07-18T10:59:59.000Z";

    const readiness = getDuskDsDeployReadiness(state, now);
    const access = readiness.checks.find((check) => check.id === "access");

    expect(readiness.evidenceReady).toBe(false);
    expect(readiness.nextRoute).toBe("access");
    expect(access).toMatchObject({
      state: "needs-evidence",
      observedAt: "2026-07-18T10:59:59.000Z",
      expiresAt: "2026-07-19T10:59:59.000Z"
    });
  });

  it("rejects future-dated readiness evidence", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const state = recordPreDeployEvidence(now.toISOString());
    for (const entry of state.paths.duskds.setup.evidenceEntries) {
      entry.observedAt = "2026-07-19T12:00:01.000Z";
    }

    const readiness = getDuskDsDeployReadiness(state, now);
    expect(readiness.evidenceReady).toBe(false);
    expect(readiness.nextRoute).toBe("setup");
  });

  it("rejects a mixed Build window when any required observation is future-dated", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const state = recordPreDeployEvidence(now.toISOString());
    state.paths.duskds.build.evidenceEntries[0].observedAt = "2026-07-19T11:59:59.000Z";
    state.paths.duskds.build.evidenceEntries[1].observedAt = "2026-07-19T12:00:01.000Z";
    state.paths.duskds.build.evidenceEntries[2].observedAt = "2026-07-19T11:59:58.000Z";

    const readiness = getDuskDsDeployReadiness(state, now);
    expect(readiness.evidenceReady).toBe(false);
    expect(readiness.nextRoute).toBe("build");
    expect(readiness.checks.find((check) => check.id === "build")).toMatchObject({
      state: "needs-evidence"
    });
  });
});
