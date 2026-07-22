import { describe, expect, it } from "vitest";
import { STUDIO_RELEASE } from "../release";
import { createInitialJourneyProgress } from "./journeyProgress";
import { createSafeDiagnostics } from "./safeDiagnostics";

describe("safe diagnostics", () => {
  it("distinguishes browser-step readiness from DuskEVM network activation", () => {
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
      availability: "pre-launch-reference-only",
      testnetStatus: "not-studio-activated",
      completionTracking: false
    });
  });
});
