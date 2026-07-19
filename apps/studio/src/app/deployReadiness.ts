import {
  getStepRequirements,
  isJourneyComplete,
  type EvidenceCode,
  type JourneyProgressState,
  type StepRoute
} from "./journeyProgress";

export type DeployReadinessState = "ready" | "needs-evidence" | "manual-check";

export interface DeployReadinessCheck {
  id: "setup" | "access" | "build" | "source" | "wallet";
  label: string;
  detail: string;
  state: DeployReadinessState;
  route?: StepRoute;
  observedAt?: string;
  expiresAt?: string;
}

export interface DuskDsDeployReadiness {
  evidenceReady: boolean;
  readyCount: number;
  requiredCount: number;
  nextRoute?: StepRoute;
  checks: DeployReadinessCheck[];
}

const SOURCE_BINDING_CODE: EvidenceCode = "duskds-inspect-artifact-revision";
const READINESS_MAX_AGE_HOURS = {
  setup: 30 * 24,
  access: 24,
  build: 30 * 24,
  source: 30 * 24
} as const;

function hasEvidence(state: JourneyProgressState, route: StepRoute, codes: EvidenceCode[]): boolean {
  const recorded = new Set(state.paths.duskds[route].evidence);
  return codes.every((code) => recorded.has(code));
}

function evidenceWindow(
  state: JourneyProgressState,
  route: StepRoute,
  codes: EvidenceCode[],
  maxAgeHours: number,
  now: Date
): { fresh: boolean; observedAt?: string; expiresAt?: string } {
  const entries = new Map(state.paths.duskds[route].evidenceEntries.map((entry) => [entry.code, entry]));
  const timestamps = codes
    .map((code) => entries.get(code)?.observedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value));
  if (timestamps.length !== codes.length || timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return { fresh: false };
  }
  const oldest = Math.min(...timestamps);
  const expires = oldest + maxAgeHours * 60 * 60 * 1_000;
  const hasFutureEvidence = timestamps.some((timestamp) => timestamp > now.getTime());
  return {
    fresh: !hasFutureEvidence && expires > now.getTime(),
    observedAt: new Date(oldest).toISOString(),
    expiresAt: new Date(expires).toISOString()
  };
}

function completedEvidenceWindow(state: JourneyProgressState, route: StepRoute, now: Date) {
  const step = state.paths.duskds[route];
  const window = evidenceWindow(
    state,
    route,
    getStepRequirements("duskds", route),
    READINESS_MAX_AGE_HOURS[route as "setup" | "access" | "build"],
    now
  );
  return {
    ...window,
    ready: isJourneyComplete(step.status)
      && !step.blocker
      && hasEvidence(state, route, getStepRequirements("duskds", route))
      && window.fresh
  };
}

export function getDuskDsBuildSourceRevision(state: JourneyProgressState): string | undefined {
  const revisionByCode = new Map(
    state.paths.duskds.build.evidenceEntries.map((entry) => [entry.code, entry.metadata?.revision])
  );
  const artifactRevision = revisionByCode.get("duskds-build-artifact-attestation");
  const testRevision = revisionByCode.get("duskds-vm-test-attestation");
  return artifactRevision && testRevision && artifactRevision === testRevision
    ? artifactRevision
    : undefined;
}

export function getDuskDsDeployReadiness(state: JourneyProgressState, now = new Date()): DuskDsDeployReadiness {
  const buildRevision = getDuskDsBuildSourceRevision(state);
  const sourceEntry = state.paths.duskds.inspect.evidenceEntries
    .find((entry) => entry.code === SOURCE_BINDING_CODE);
  const inspectedRevision = sourceEntry?.metadata?.revision;
  const setup = completedEvidenceWindow(state, "setup", now);
  const access = completedEvidenceWindow(state, "access", now);
  const build = completedEvidenceWindow(state, "build", now);
  const source = evidenceWindow(
    state,
    "inspect",
    [SOURCE_BINDING_CODE],
    READINESS_MAX_AGE_HOURS.source,
    now
  );
  const evidenceChecks: DeployReadinessCheck[] = [
    {
      id: "setup",
      label: "Native toolchain",
      detail: "Required Rust, WASM, and reviewed Dusk Forge checks must have been recorded within 30 days.",
      state: setup.ready ? "ready" : "needs-evidence",
      route: "setup",
      ...(setup.observedAt ? { observedAt: setup.observedAt, expiresAt: setup.expiresAt } : {})
    },
    {
      id: "access",
      label: "Read-only Testnet access",
      detail: "A bounded DuskDS Testnet node observation must be no more than 24 hours old.",
      state: access.ready ? "ready" : "needs-evidence",
      route: "access",
      ...(access.observedAt ? { observedAt: access.observedAt, expiresAt: access.expiresAt } : {})
    },
    {
      id: "build",
      label: "Build and VM test",
      detail: "Forge structure, both WASM artifacts, and the reviewed VM-test result must have been recorded within 30 days.",
      state: build.ready ? "ready" : "needs-evidence",
      route: "build",
      ...(build.observedAt ? { observedAt: build.observedAt, expiresAt: build.expiresAt } : {})
    },
    {
      id: "source",
      label: "Source identity",
      detail: "The contract and data-driver build must be bound to one Git source identity within 30 days.",
      state: buildRevision && inspectedRevision === buildRevision && source.fresh ? "ready" : "needs-evidence",
      route: "inspect",
      ...(source.observedAt ? { observedAt: source.observedAt, expiresAt: source.expiresAt } : {})
    }
  ];
  const readyCount = evidenceChecks.filter((check) => check.state === "ready").length;
  const nextRoute = evidenceChecks.find((check) => check.state === "needs-evidence")?.route;
  return {
    evidenceReady: readyCount === evidenceChecks.length,
    readyCount,
    requiredCount: evidenceChecks.length,
    ...(nextRoute ? { nextRoute } : {}),
    checks: [
      ...evidenceChecks,
      {
        id: "wallet",
        label: "Wallet, funding, and deploy values",
        detail: "Check these manually in Rusk Wallet. Studio cannot inspect profiles, balances, passwords, fees, init arguments, or nonces.",
        state: "manual-check"
      }
    ]
  };
}
