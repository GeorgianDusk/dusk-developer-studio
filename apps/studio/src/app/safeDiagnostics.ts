import type { StudioRelease } from "../release";
import type { BuilderPath, JourneyProgressState } from "./journeyProgress";
import { sourceFreshness } from "./studioConfig";
import type { StudioRuntime } from "./runtime";

export const SAFE_DIAGNOSTIC_JOURNEY_CONTEXT = {
  statusSemantics: {
    ready: "Browser journey step is ready to start; this is not proof that a network or service is live."
  },
  pathAvailability: {
    evm: {
      availability: "pre-launch-reference-only",
      testnetStatus: "not-studio-activated",
      completionTracking: false
    },
    duskds: {
      availability: "active-developer-workflow",
      completionTracking: true
    }
  }
} as const;

export function createSafeDiagnostics({
  studioRuntime,
  release,
  builderPath,
  companionBaseUrl,
  journey
}: {
  studioRuntime: StudioRuntime;
  release: StudioRelease;
  builderPath: BuilderPath | null;
  companionBaseUrl: string | null;
  journey: JourneyProgressState;
}) {
  return {
    mode: studioRuntime.mode,
    release,
    builderPath,
    sourceReceipt: {
      status: sourceFreshness.status,
      reviewedAt: sourceFreshness.reviewed_at,
      expiresAt: sourceFreshness.expires_at,
      recordCounts: sourceFreshness.provenance.record_counts
    },
    localAgentUrl: companionBaseUrl ?? "not-applicable-hosted",
    journeyContext: SAFE_DIAGNOSTIC_JOURNEY_CONTEXT,
    journey
  };
}
