export type BuilderPath = "evm" | "duskds";
export type StepRoute = "setup" | "access" | "build" | "inspect";

export type EvidenceMethod = "automatic" | "manual";
export type EvidenceStatus = "passed-automatically" | "confirmed-manually";
export type JourneyStatus =
  | "not-started"
  | "ready"
  | EvidenceStatus
  | "blocked"
  | "skipped"
  /** Accepted while the UI and existing browser records migrate to provenance-aware states. */
  | "verified"
  /** Accepted while the UI and existing browser records migrate to the human-readable skipped state. */
  | "skipped-with-reason";

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
  | "duskds-inspect-latest-block"
  | "duskds-inspect-artifact-revision"
  | "duskds-inspect-driver-availability"
  | "duskds-inspect-driver-schema"
  | "duskds-inspect-driver-encode"
  | "duskds-inspect-driver-decode"
  /** Accepted only so legacy browser records can be discarded without failing to parse. */
  | "duskds-read-inspection-attestation";

export type BlockerCode =
  | "rpc-unavailable"
  | "duskds-public-node-unavailable"
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

export type EvidenceSource = "companion" | "browser-check" | "manual-confirmation" | "legacy-storage";
export type EvidenceTool =
  | "rpc"
  | "wallet"
  | "git"
  | "rustup"
  | "rustc"
  | "cargo"
  | "deno"
  | "dusk-forge"
  | "w3sper"
  | "wasm32-unknown-unknown"
  | "rust-src"
  | "forge-starter"
  | "studio-reviewed-template";
export type EvidencePlatform = "windows" | "macos" | "linux" | "wsl" | "browser";
export type EvidenceTestEnvironment = "windows" | "macos" | "linux" | "wsl-ubuntu-24.04";

/**
 * Deliberately narrow metadata. Accounts, balances, raw RPC responses, paths,
 * terminal output, free-form notes, and other unbounded user-controlled values do
 * not belong in browser progress storage. Explicit block and artifact hashes are
 * accepted only after strict format and size validation.
 */
export interface EvidenceMetadata {
  source?: EvidenceSource;
  tool?: EvidenceTool;
  version?: string;
  revision?: string;
  platform?: EvidencePlatform;
  checkCount?: number;
  cleanTree?: boolean;
  sourceScope?: "git-commit-plus-unignored-working-tree";
  postBuildSourceCheck?: boolean;
  blockHeight?: number;
  blockHash?: string;
  /** Sanitized URL origin only; credentials, query strings, fragments, and paths are discarded. */
  endpoint?: string;
  contractId?: string;
  functionName?: string;
  responseSha256?: string;
  contractArtifactName?: string;
  contractArtifactSha256?: string;
  contractArtifactSizeBytes?: number;
  dataDriverArtifactName?: string;
  dataDriverArtifactSha256?: string;
  dataDriverArtifactSizeBytes?: number;
  testEnvironment?: EvidenceTestEnvironment;
  testsPassed?: boolean;
}

export interface EvidenceEntry {
  code: EvidenceCode;
  method: EvidenceMethod;
  status: EvidenceStatus;
  observedAt: string;
  metadata?: EvidenceMetadata;
}

export interface RecordEvidenceOptions {
  method?: EvidenceMethod;
  observedAt?: string;
  metadata?: EvidenceMetadata;
}

export interface StepProgress {
  status: JourneyStatus;
  /**
   * Compatibility projection used by the existing route components. New code
   * should read evidenceEntries when it needs provenance or timestamps.
   */
  evidence: EvidenceCode[];
  evidenceEntries: EvidenceEntry[];
  blocker?: BlockerCode;
  checkedAt?: string;
}

export type PathProgress = Record<StepRoute, StepProgress>;
export interface JourneyProgressState {
  version: 1;
  paths: Record<BuilderPath, PathProgress>;
}

export interface JourneyCompletionCounts {
  completed: number;
  automatic: number;
  manual: number;
  skipped: number;
  total: number;
}

export interface EvidenceProvenanceCounts {
  automatic: number;
  manual: number;
  total: number;
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
    inspect: [
      "duskds-inspect-latest-block",
      "duskds-inspect-artifact-revision",
      "duskds-inspect-driver-availability",
      "duskds-inspect-driver-schema",
      "duskds-inspect-driver-encode",
      "duskds-inspect-driver-decode"
    ]
  }
};

const statuses = new Set<JourneyStatus>([
  "not-started",
  "ready",
  "passed-automatically",
  "confirmed-manually",
  "blocked",
  "skipped",
  "verified",
  "skipped-with-reason"
]);
const evidenceMethods = new Set<EvidenceMethod>(["automatic", "manual"]);
const evidenceStatuses = new Set<EvidenceStatus>(["passed-automatically", "confirmed-manually"]);
const evidenceSources = new Set<EvidenceSource>(["companion", "browser-check", "manual-confirmation", "legacy-storage"]);
const evidenceTools = new Set<EvidenceTool>([
  "rpc",
  "wallet",
  "git",
  "rustup",
  "rustc",
  "cargo",
  "deno",
  "dusk-forge",
  "w3sper",
  "wasm32-unknown-unknown",
  "rust-src",
  "forge-starter",
  "studio-reviewed-template"
]);
const evidencePlatforms = new Set<EvidencePlatform>(["windows", "macos", "linux", "wsl", "browser"]);
const evidenceTestEnvironments = new Set<EvidenceTestEnvironment>(["windows", "macos", "linux", "wsl-ubuntu-24.04"]);
const evidenceCodes = new Set<EvidenceCode>(Object.values(requirements).flatMap((path) => Object.values(path).flat()));
evidenceCodes.add("duskds-read-inspection-attestation");
const blockerCodes = new Set<BlockerCode>([
  "rpc-unavailable", "duskds-public-node-unavailable", "wrong-chain", "no-wallet", "no-account", "insufficient-gas", "companion-unavailable",
  "toolchain-incomplete", "unsupported-platform", "invalid-identifier", "result-not-found", "local-build-unverified", "user-deferred"
]);
const automaticLegacyEvidence = new Set<EvidenceCode>([
  "evm-rpc-chain",
  "evm-wallet-chain",
  "evm-wallet-account",
  "evm-balance-read",
  "evm-starter-structure",
  "duskds-required-preflight",
  "duskds-starter-structure"
]);

function emptyStep(status: JourneyStatus): StepProgress {
  return { status, evidence: [], evidenceEntries: [] };
}

function emptyPath(): PathProgress {
  return {
    setup: emptyStep("ready"),
    access: emptyStep("not-started"),
    build: emptyStep("not-started"),
    inspect: emptyStep("not-started")
  };
}

export function createInitialJourneyProgress(): JourneyProgressState {
  return { version: 1, paths: { evm: emptyPath(), duskds: emptyPath() } };
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

function normalizeVersion(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9.+_:/-]*$/.test(value)) return undefined;
  return value;
}

function normalizeRevision(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) return undefined;
  return value.toLowerCase();
}

function normalizeBlockHash(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?:0x)?[a-f0-9]{64}$/i.test(value)) return undefined;
  return value.toLowerCase();
}

function normalizeEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 200) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function normalizeArtifactName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 128 || value.includes("/") || value.includes("\\")) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.wasm$/.test(value) ? value : undefined;
}

function normalizeSha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function normalizeContractId(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?:0x)?[a-f0-9]{64}$/i.test(value)) return undefined;
  return value.replace(/^0x/i, "").toLowerCase();
}

function normalizeFunctionName(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function normalizeArtifactSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100 * 1024 * 1024
    ? value
    : undefined;
}

function normalizeMetadata(candidate: unknown): EvidenceMetadata | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const raw = candidate as Record<string, unknown>;
  const source = typeof raw.source === "string" && evidenceSources.has(raw.source as EvidenceSource)
    ? raw.source as EvidenceSource
    : undefined;
  const tool = typeof raw.tool === "string" && evidenceTools.has(raw.tool as EvidenceTool)
    ? raw.tool as EvidenceTool
    : undefined;
  const version = normalizeVersion(raw.version);
  const revision = normalizeRevision(raw.revision);
  const platform = typeof raw.platform === "string" && evidencePlatforms.has(raw.platform as EvidencePlatform)
    ? raw.platform as EvidencePlatform
    : undefined;
  const checkCount = typeof raw.checkCount === "number" && Number.isSafeInteger(raw.checkCount) && raw.checkCount >= 0 && raw.checkCount <= 100
    ? raw.checkCount
    : undefined;
  const cleanTree = typeof raw.cleanTree === "boolean" ? raw.cleanTree : undefined;
  const sourceScope = raw.sourceScope === "git-commit-plus-unignored-working-tree"
    ? raw.sourceScope
    : undefined;
  const postBuildSourceCheck = typeof raw.postBuildSourceCheck === "boolean"
    ? raw.postBuildSourceCheck
    : undefined;
  const blockHeight = typeof raw.blockHeight === "number" && Number.isSafeInteger(raw.blockHeight) && raw.blockHeight >= 0
    ? raw.blockHeight
    : undefined;
  const blockHash = normalizeBlockHash(raw.blockHash);
  const endpoint = normalizeEndpoint(raw.endpoint);
  const contractId = normalizeContractId(raw.contractId);
  const functionName = normalizeFunctionName(raw.functionName);
  const responseSha256 = normalizeSha256(raw.responseSha256);
  const contractArtifactName = normalizeArtifactName(raw.contractArtifactName);
  const contractArtifactSha256 = normalizeSha256(raw.contractArtifactSha256);
  const contractArtifactSizeBytes = normalizeArtifactSize(raw.contractArtifactSizeBytes);
  const dataDriverArtifactName = normalizeArtifactName(raw.dataDriverArtifactName);
  const dataDriverArtifactSha256 = normalizeSha256(raw.dataDriverArtifactSha256);
  const dataDriverArtifactSizeBytes = normalizeArtifactSize(raw.dataDriverArtifactSizeBytes);
  const testEnvironment = typeof raw.testEnvironment === "string" && evidenceTestEnvironments.has(raw.testEnvironment as EvidenceTestEnvironment)
    ? raw.testEnvironment as EvidenceTestEnvironment
    : undefined;
  const testsPassed = typeof raw.testsPassed === "boolean" ? raw.testsPassed : undefined;
  const metadata: EvidenceMetadata = {
    ...(source ? { source } : {}),
    ...(tool ? { tool } : {}),
    ...(version ? { version } : {}),
    ...(revision ? { revision } : {}),
    ...(platform ? { platform } : {}),
    ...(checkCount !== undefined ? { checkCount } : {}),
    ...(cleanTree !== undefined ? { cleanTree } : {}),
    ...(sourceScope ? { sourceScope } : {}),
    ...(postBuildSourceCheck !== undefined ? { postBuildSourceCheck } : {}),
    ...(blockHeight !== undefined ? { blockHeight } : {}),
    ...(blockHash ? { blockHash } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(contractId ? { contractId } : {}),
    ...(functionName ? { functionName } : {}),
    ...(responseSha256 ? { responseSha256 } : {}),
    ...(contractArtifactName ? { contractArtifactName } : {}),
    ...(contractArtifactSha256 ? { contractArtifactSha256 } : {}),
    ...(contractArtifactSizeBytes !== undefined ? { contractArtifactSizeBytes } : {}),
    ...(dataDriverArtifactName ? { dataDriverArtifactName } : {}),
    ...(dataDriverArtifactSha256 ? { dataDriverArtifactSha256 } : {}),
    ...(dataDriverArtifactSizeBytes !== undefined ? { dataDriverArtifactSizeBytes } : {}),
    ...(testEnvironment ? { testEnvironment } : {}),
    ...(testsPassed !== undefined ? { testsPassed } : {})
  };
  return Object.keys(metadata).length ? metadata : undefined;
}

function statusForMethod(method: EvidenceMethod): EvidenceStatus {
  return method === "automatic" ? "passed-automatically" : "confirmed-manually";
}

function normalizeEvidenceEntry(candidate: unknown, allowed: EvidenceCode[]): EvidenceEntry | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const raw = candidate as Partial<Record<keyof EvidenceEntry, unknown>>;
  if (typeof raw.code !== "string" || !evidenceCodes.has(raw.code as EvidenceCode) || !allowed.includes(raw.code as EvidenceCode)) return undefined;
  if (typeof raw.method !== "string" || !evidenceMethods.has(raw.method as EvidenceMethod)) return undefined;
  const method = raw.method as EvidenceMethod;
  if (typeof raw.status !== "string" || !evidenceStatuses.has(raw.status as EvidenceStatus) || raw.status !== statusForMethod(method)) return undefined;
  const observedAt = normalizeTimestamp(raw.observedAt);
  if (!observedAt) return undefined;
  const metadata = normalizeMetadata(raw.metadata);
  return {
    code: raw.code as EvidenceCode,
    method,
    status: statusForMethod(method),
    observedAt,
    ...(metadata ? { metadata } : {})
  };
}

function inferLegacyMethod(code: EvidenceCode): EvidenceMethod {
  return automaticLegacyEvidence.has(code) ? "automatic" : "manual";
}

function legacyEntry(code: EvidenceCode, checkedAt: string): EvidenceEntry {
  const method = inferLegacyMethod(code);
  return {
    code,
    method,
    status: statusForMethod(method),
    observedAt: checkedAt,
    metadata: { source: "legacy-storage" }
  };
}

function normalizePath(path: BuilderPath, candidate: unknown): PathProgress {
  const source = candidate && typeof candidate === "object" ? candidate as Partial<Record<StepRoute, unknown>> : {};
  const normalized = emptyPath();
  for (const route of STEP_ROUTES) {
    const raw = source[route];
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Partial<StepProgress>;
    const checkedAt = normalizeTimestamp(value.checkedAt);
    const storedEvidence = Array.isArray(value.evidence)
      ? [...new Set(value.evidence.filter((item): item is EvidenceCode => (
        typeof item === "string"
        && evidenceCodes.has(item as EvidenceCode)
      )))]
      : [];
    const legacyEvidence = storedEvidence.filter((code) => requirements[path][route].includes(code));
    const entryByCode = new Map<EvidenceCode, EvidenceEntry>();
    if (Array.isArray(value.evidenceEntries)) {
      for (const candidateEntry of value.evidenceEntries) {
        const entry = normalizeEvidenceEntry(candidateEntry, requirements[path][route]);
        if (entry) entryByCode.set(entry.code, entry);
      }
    }
    if (checkedAt) {
      for (const code of legacyEvidence) {
        if (!entryByCode.has(code)) entryByCode.set(code, legacyEntry(code, checkedAt));
      }
    }
    const evidenceEntries = [...entryByCode.values()];
    const evidence = evidenceEntries.map((entry) => entry.code);
    const rawStatus = typeof value.status === "string" && statuses.has(value.status as JourneyStatus)
      ? value.status as JourneyStatus
      : normalized[route].status;
    const status = rawStatus === "skipped-with-reason" ? "skipped" : rawStatus;
    const blocker = typeof value.blocker === "string" && blockerCodes.has(value.blocker as BlockerCode)
      ? value.blocker as BlockerCode
      : undefined;
    const lastObservedAt = evidenceEntries
      .map((entry) => entry.observedAt)
      .sort()
      .at(-1);
    normalized[route] = {
      status,
      evidence,
      evidenceEntries,
      ...(blocker ? { blocker } : {}),
      ...((lastObservedAt ?? checkedAt) ? { checkedAt: lastObservedAt ?? checkedAt } : {})
    };
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

export function isJourneyComplete(status: JourneyStatus): status is EvidenceStatus | "verified" {
  return status === "passed-automatically" || status === "confirmed-manually" || status === "verified";
}

export function getJourneyStatusLabel(status: JourneyStatus): string {
  switch (status) {
    case "passed-automatically": return "Passed automatically";
    case "confirmed-manually": return "Confirmed manually";
    case "skipped":
    case "skipped-with-reason": return "Skipped for now";
    case "not-started": return "Waiting on earlier step";
    case "ready": return "Ready to start";
    case "blocked": return "Blocked";
    case "verified": return "Completed";
  }
}

function normalizeReadiness(path: BuilderPath, progress: PathProgress): PathProgress {
  const next = structuredClone(progress);
  for (const [index, route] of STEP_ROUTES.entries()) {
    const step = next[route];
    const required = requirements[path][route];
    const requiredEntries = required
      .map((code) => step.evidenceEntries.find((entry) => entry.code === code))
      .filter((entry): entry is EvidenceEntry => Boolean(entry));
    const complete = requiredEntries.length === required.length;
    const previous = index === 0 ? undefined : next[STEP_ROUTES[index - 1]];
    const previousComplete = !previous
      || isJourneyComplete(previous.status)
      || previous.status === "skipped"
      || previous.status === "skipped-with-reason";
    if (complete && previousComplete) {
      step.status = requiredEntries.every((entry) => entry.method === "automatic")
        ? "passed-automatically"
        : "confirmed-manually";
      delete step.blocker;
      continue;
    }
    if (isJourneyComplete(step.status)) step.status = "ready";
    if (step.status === "blocked" || step.status === "skipped" || step.status === "skipped-with-reason") continue;
    step.status = previousComplete ? "ready" : "not-started";
  }
  return next;
}

export function recordJourneyEvidence(
  state: JourneyProgressState,
  path: BuilderPath,
  route: StepRoute,
  additions: EvidenceCode[],
  options: RecordEvidenceOptions = {}
): JourneyProgressState {
  const next = structuredClone(state);
  const allowed = requirements[path][route];
  const step = next.paths[path][route];
  const method = options.method ?? "manual";
  const observedAt = normalizeTimestamp(options.observedAt) ?? new Date().toISOString();
  const suppliedMetadata = normalizeMetadata(options.metadata);
  const metadata: EvidenceMetadata = {
    source: method === "automatic" ? "browser-check" : "manual-confirmation",
    ...suppliedMetadata
  };
  const entryByCode = new Map(step.evidenceEntries.map((entry) => [entry.code, entry]));
  const acceptedAdditions = additions.filter((item) => allowed.includes(item));
  for (const code of acceptedAdditions) {
    entryByCode.set(code, {
      code,
      method,
      status: statusForMethod(method),
      observedAt,
      metadata
    });
  }
  step.evidenceEntries = [...entryByCode.values()];
  step.evidence = step.evidenceEntries.map((entry) => entry.code);
  step.checkedAt = observedAt;
  step.status = "ready";
  delete step.blocker;
  next.paths[path] = normalizeReadiness(path, next.paths[path]);
  return next;
}

export function removeJourneyEvidence(
  state: JourneyProgressState,
  path: BuilderPath,
  route: StepRoute,
  removals: EvidenceCode[]
): JourneyProgressState {
  const next = structuredClone(state);
  const step = next.paths[path][route];
  const removalSet = new Set(removals);
  const retained = step.evidenceEntries.filter((entry) => !removalSet.has(entry.code));
  if (retained.length === step.evidenceEntries.length) return next;

  step.evidenceEntries = retained;
  step.evidence = retained.map((entry) => entry.code);
  step.status = "ready";
  delete step.blocker;
  const latestObservation = retained.map((entry) => entry.observedAt).sort().at(-1);
  if (latestObservation) step.checkedAt = latestObservation;
  else delete step.checkedAt;

  const start = STEP_ROUTES.indexOf(route);
  for (const downstream of STEP_ROUTES.slice(start + 1)) {
    next.paths[path][downstream] = emptyStep("not-started");
  }
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
  next.paths[path][route] = { ...next.paths[path][route], status: "skipped", blocker, checkedAt: new Date().toISOString() };
  next.paths[path] = normalizeReadiness(path, next.paths[path]);
  return next;
}

export function resumeJourneyStep(state: JourneyProgressState, path: BuilderPath, route: StepRoute): JourneyProgressState {
  const next = structuredClone(state);
  const step = next.paths[path][route];
  if (step.status !== "skipped" && step.status !== "skipped-with-reason") return next;
  step.status = "ready";
  delete step.blocker;
  delete step.checkedAt;
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
    next.paths[path][affected] = emptyStep(affected === route ? "ready" : "not-started");
  }
  next.paths[path] = normalizeReadiness(path, next.paths[path]);
  return next;
}

export function getStepRequirements(path: BuilderPath, route: StepRoute): EvidenceCode[] {
  return [...requirements[path][route]];
}

export function getJourneyCompletionCounts(state: JourneyProgressState, path: BuilderPath): JourneyCompletionCounts {
  const progress = STEP_ROUTES.map((route) => state.paths[path][route]);
  const automatic = progress.filter((step) => step.status === "passed-automatically").length;
  const manual = progress.filter((step) => step.status === "confirmed-manually" || step.status === "verified").length;
  const skipped = progress.filter((step) => step.status === "skipped" || step.status === "skipped-with-reason").length;
  return { completed: automatic + manual, automatic, manual, skipped, total: STEP_ROUTES.length };
}

export function getEvidenceProvenanceCounts(state: JourneyProgressState, path: BuilderPath): EvidenceProvenanceCounts {
  const entries = STEP_ROUTES.flatMap((route) => state.paths[path][route].evidenceEntries);
  const automatic = entries.filter((entry) => entry.method === "automatic").length;
  const manual = entries.filter((entry) => entry.method === "manual").length;
  return { automatic, manual, total: entries.length };
}

/** @deprecated Prefer getJourneyCompletionCounts so automatic and manual completion remain visible. */
export function countVerifiedSteps(state: JourneyProgressState, path: BuilderPath): number {
  return getJourneyCompletionCounts(state, path).completed;
}
