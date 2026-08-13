import { describe, expect, it } from "vitest";
import { STUDIO_RELEASE } from "../release";
import { createInitialJourneyProgress } from "./journeyProgress";
import { createSafeDiagnostics } from "./safeDiagnostics";

describe("safe diagnostics", () => {
  it("reports active DuskEVM Testnet without treating an unrun step as evidence", () => {
    const diagnostics = createSafeDiagnostics({
      studioRuntime: {
        mode: "hosted-guide",
        companionAvailable: false,
        label: "Hosted guide",
        channel: "hosted"
      },
      release: STUDIO_RELEASE,
      builderPath: "evm",
      companionBaseUrl: null,
      journey: createInitialJourneyProgress()
    });

    expect(diagnostics.journey.paths.evm.setup.status).toBe("ready");
    expect(diagnostics.journeyContext.statusSemantics.ready).toMatch(/not proof.*network.*live/i);
    expect(diagnostics.journeyContext.pathAvailability.evm).toEqual({
      availability: "testnet-active",
      testnetStatus: "studio-activated",
      completionTracking: true
    });
  });
});
