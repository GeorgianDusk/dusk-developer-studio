export type BuilderPath = "evm" | "duskds";
export type StepRoute = "setup" | "access" | "build" | "inspect";
export type JourneyStatus = "not-started" | "ready" | "verified" | "blocked" | "skipped-with-reason";

export type EvidenceCode =
  | "evm-rpc-chain"
  | "evm-wallet-chain"
  | "evm-wallet-account"
  | "evm-balance-read"
  | "evm-positive-balance"
  | "evm-starter-structure"
  | "evm-build-test-attestation"
  | "evm-read-inspection"
  | "duskds-required-preflight"
  | "duskds-node-read-attestation"
  | "duskds-starter-structure"
  | "duskds-build-artifact-attestation"
  | "duskds-vm-test-attestation"
  | "duskds-read-inspection-attestation";

export type BlockerCode =
  | "rpc-unavailable"
  | "wrong-chain"
  | "no-wallet"
  | "no-account"
  | "insufficient-gas"
  | "companion-unavailable"
  | "toolchain-incomplete"
  | "unsupported-platform"
  | "invalid-identifier"
  | "result-not-found"
  | "local-build-unverified"
  | "user-deferred";

export interface StepProgress {
  status: JourneyStatus;
  evidence: EvidenceCode[];
  blocker?: BlockerCode;
  checkedAt?: string;
}

export type PathProgress = Record<StepRoute, StepProgress>;
export interface JourneyProgressState {
  version: 1;
  paths: Record<BuilderPath, PathProgress>;
}

export const JOURNEY_PROGRESS_STORAGE_KEY = "dusk-studio-journey-progress-v1";
export const STEP_ROUTES: StepRoute[] = ["setup", "access", "build", "inspect"];

const requirements: Record<BuilderPath, Record<StepRoute, EvidenceCode[]>> = {
  evm: {
    setup: ["evm-rpc-chain", "evm-wallet-chain", "evm-wallet-account", "evm-balance-read"],
    access: ["evm-positive-balance"],
    build: ["evm-starter-structure", "evm-build-test-attestation"],
    inspect: ["evm-read-inspection"]
  },
  duskds: {
    setup: ["duskds-required-preflight"],
    access: ["duskds-node-read-attestation"],
    build: ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
    inspect: ["duskds-read-inspection-attestation"]
  }
};

const statuses = new Set<JourneyStatus>(["not-started", "ready", "verified", "blocked", "skipped-with-reason"]);
const evidenceCodes = new Set<EvidenceCode>(Object.values(requirements).flatMap((path) => Object.values(path).flat()));
const blockerCodes = new Set<BlockerCode>([
  "rpc-unavailable", "wrong-chain", "no-wallet", "no-account", "insufficient-gas", "companion-unavailable",
  "toolchain-incomplete", "unsupported-platform", "invalid-identifier", "result-not-found", "local-build-unverified", "user-deferred"
]);

function emptyPath(): PathProgress {
  return {
    setup: { status: "ready", evidence: [] },
    access: { status: "not-started", evidence: [] },
    build: { status: "not-started", evidence: [] },
    inspect: { status: "not-started", evidence: [] }
  };
}

export function createInitialJourneyProgress(): JourneyProgressState {
  return { version: 1, paths: { evm: emptyPath(), duskds: emptyPath() } };
}

function normalizePath(path: BuilderPath, candidate: unknown): PathProgress {
  const source = candidate && typeof candidate === "object" ? candidate as Partial<Record<StepRoute, unknown>> : {};
  const normalized = emptyPath();
  for (const route of STEP_ROUTES) {
    const raw = source[route];
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Partial<StepProgress>;
    const evidence = Array.isArray(value.evidence)
      ? [...new Set(value.evidence.filter((item): item is EvidenceCode => typeof item === "string" && evidenceCodes.has(item as EvidenceCode)))]
      : [];
    const status = typeof value.status === "string" && statuses.has(value.status as JourneyStatus) ? value.status as JourneyStatus : normalized[route].status;
    const blocker = typeof value.blocker === "string" && blockerCodes.has(value.blocker as BlockerCode) ? value.blocker as BlockerCode : undefined;
    const checkedAt = typeof value.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value.checkedAt) ? value.checkedAt.slice(0, 32) : undefined;
    normalized[route] = { status, evidence: evidence.filter((item) => requirements[path][route].includes(item)), ...(blocker ? { blocker } : {}), ...(checkedAt ? { checkedAt } : {}) };
  }
  return normalizeReadiness(path, normalized);
}

export function parseJourneyProgress(serialized: string | null): JourneyProgressState {
  if (!serialized) return createInitialJourneyProgress();
  try {
    const raw = JSON.parse(serialized) as { version?: unknown; paths?: Partial<Record<BuilderPath, unknown>> };
    if (raw.version !== 1 || !raw.paths) return createInitialJourneyProgress();
    return { version: 1, paths: { evm: normalizePath("evm", raw.paths.evm), duskds: normalizePath("duskds", raw.paths.duskds) } };
  } catch {
    return createInitialJourneyProgress();
  }
}

function normalizeReadiness(path: BuilderPath, progress: PathProgress): PathProgress {
  const next = structuredClone(progress);
  for (const [index, route] of STEP_ROUTES.entries()) {
    const step = next[route];
    const complete = requirements[path][route].every((evidence) => step.evidence.includes(evidence));
    if (complete) {
      step.status = "verified";
      delete step.blocker;
      continue;
    }
    if (step.status === "verified") step.status = "ready";
    if (step.status === "blocked" || step.status === "skipped-with-reason") continue;
    const previous = index === 0 ? undefined : next[STEP_ROUTES[index - 1]];
    step.status = !previous || previous.status === "verified" || previous.status === "skipped-with-reason" ? "ready" : "not-started";
  }
  return next;
}

export function recordJourneyEvidence(state: JourneyProgressState, path: BuilderPath, route: StepRoute, additions: EvidenceCode[]): JourneyProgressState {
  const next = structuredClone(state);
  const allowed = requirements[path][route];
  const step = next.paths[path][route];
  step.evidence = [...new Set([...step.evidence, ...additions.filter((item) => allowed.includes(item))])];
  step.checkedAt = new Date().toISOString();
  step.status = "ready";
  delete step.blocker;
  next.paths[path] = normalizeReadiness(path, next.paths[path]);
  return next;
}

export function blockJourneyStep(state: JourneyProgressState, path: BuilderPath, route: StepRoute, blocker: BlockerCode): JourneyProgressState {
  const next = structuredClone(state);
  next.paths[path][route] = { ...next.paths[path][route], status: "blocked", blocker, checkedAt: new Date().toISOString() };
  return next;
}

export function skipJourneyStep(state: JourneyProgressState, path: BuilderPath, route: StepRoute, blocker: BlockerCode): JourneyProgressState {
  const next = structuredClone(state);
  next.paths[path][route] = { ...next.paths[path][route], status: "skipped-with-reason", blocker, checkedAt: new Date().toISOString() };
  next.paths[path] = normalizeReadiness(path, next.paths[path]);
  return next;
}

export function invalidateJourneyFrom(
  state: JourneyProgressState,
  path: BuilderPath,
  route: StepRoute
): JourneyProgressState {
  const next = structuredClone(state);
  const start = STEP_ROUTES.indexOf(route);
  for (const affected of STEP_ROUTES.slice(start)) {
    next.paths[path][affected] = { status: affected === route ? "ready" : "not-started", evidence: [] };
  }
  next.paths[path] = normalizeReadiness(path, next.paths[path]);
  return next;
}
export function getStepRequirements(path: BuilderPath, route: StepRoute): EvidenceCode[] {
  return [...requirements[path][route]];
}

export function countVerifiedSteps(state: JourneyProgressState, path: BuilderPath): number {
  return STEP_ROUTES.filter((route) => state.paths[path][route].status === "verified").length;
}
