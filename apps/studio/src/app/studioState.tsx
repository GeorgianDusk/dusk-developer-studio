import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { STUDIO_RELEASE, type StudioRelease } from "../release";
import {
  JOURNEY_PROGRESS_STORAGE_KEY,
  blockJourneyStep,
  createInitialJourneyProgress,
  invalidateJourneyFrom,
  parseJourneyProgress,
  recordJourneyEvidence,
  removeJourneyEvidence,
  resumeJourneyStep,
  skipJourneyStep,
  type BlockerCode,
  type BuilderPath,
  type EvidenceCode,
  type JourneyProgressState,
  type RecordEvidenceOptions,
  type StepRoute
} from "./journeyProgress";
import { isCompanionHealth, isPairingResult } from "./responseSchemas";
import { hasLocalReleaseParity, type StudioRuntime } from "./runtime";
import { requestJson, safeRequestMessage } from "./safeRequest";
import { localAgentUrl, studioRuntime } from "./studioConfig";
import type { CompanionStatus, RouteId } from "./types";

const routeIds: RouteId[] = ["overview", "setup", "access", "build", "inspect", "reference", "troubleshooting", "companion", "settings"];

interface StudioRuntimeContextValue {
  runtime: StudioRuntime;
  release: StudioRelease;
  companionBaseUrl: string | null;
}

const StudioRuntimeContext = createContext<StudioRuntimeContextValue | undefined>(undefined);

export function RuntimeProvider({ runtime = studioRuntime, release = STUDIO_RELEASE, children }: { runtime?: StudioRuntime; release?: StudioRelease; children: ReactNode }) {
  const companionBaseUrl = runtime.companionAvailable
    ? runtime.channel === "npm" ? `http://${window.location.hostname}:8788` : localAgentUrl
    : null;
  const value = useMemo(() => ({ runtime, release, companionBaseUrl }), [runtime, release, companionBaseUrl]);
  return <StudioRuntimeContext.Provider value={value}>{children}</StudioRuntimeContext.Provider>;
}

export function useStudioRuntime(): StudioRuntimeContextValue {
  const value = useContext(StudioRuntimeContext);
  if (!value) throw new Error("Studio runtime context is missing.");
  return value;
}

function getInitialRoute(): RouteId {
  const aliases: Record<string, RouteId> = { capabilities: "reference", docs: "reference", network: "setup", funding: "access", deploy: "build", verify: "inspect" };
  const raw = window.location.hash.replace(/^#\/?/, "");
  const route = aliases[raw] ?? raw;
  return routeIds.includes(route as RouteId) ? route as RouteId : "overview";
}

export function useRoute(): [RouteId, (route: RouteId) => void] {
  const [route, setRouteState] = useState<RouteId>(getInitialRoute);
  useEffect(() => {
    const onHash = () => setRouteState(getInitialRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [route, (next) => {
    window.location.hash = next;
    setRouteState(next);
  }];
}

export function useBuilderPath(): [BuilderPath | null, (path: BuilderPath | null) => void] {
  const [path, setPath] = useState<BuilderPath | null>(() => {
    const storedPath = window.localStorage.getItem("dusk-studio-builder-path");
    return storedPath === "evm" || storedPath === "duskds" ? storedPath : null;
  });
  return [path, (next) => {
    if (next) window.localStorage.setItem("dusk-studio-builder-path", next);
    else window.localStorage.removeItem("dusk-studio-builder-path");
    setPath(next);
  }];
}

export function useCompanionStatus(): [CompanionStatus, () => Promise<void>] {
  const { runtime, release, companionBaseUrl } = useStudioRuntime();
  const localBootstrapStarted = useRef(false);
  const [status, setStatus] = useState<CompanionStatus>({
    state: "unavailable",
    message: runtime.companionAvailable
      ? "Local companion has not been checked."
      : "Hosted preview is read-only. Run the local companion for preflights or starter files."
  });
  const refresh = useCallback(async () => {
    if (!runtime.companionAvailable || !companionBaseUrl) {
      setStatus({ state: "unavailable", message: "Open the Studio locally to check the companion. The hosted site never runs machine actions." });
      return;
    }
    setStatus({ state: "checking", message: "Checking local companion..." });
    try {
      const data = await requestJson(companionBaseUrl + "/health", {
        init: { credentials: "include" }, timeoutMs: 1_200, validate: isCompanionHealth
      });
      if (runtime.channel === "npm" && !hasLocalReleaseParity(release, data.release)) {
        setStatus({
          state: "mismatch",
          message: "Local actions are blocked because the Studio and local runtime release identities do not match.",
          release: data.release
        });
        return;
      }
      setStatus({
        state: "available",
        message: data.capabilitiesEnabled ? "Paired. Local capabilities are enabled." : "Paired. Local capabilities are disabled until explicitly enabled.",
        capabilitiesEnabled: data.capabilitiesEnabled,
        release: data.release
      });
    } catch (error) {
      setStatus({ state: "unavailable", message: safeRequestMessage(error) });
    }
  }, [companionBaseUrl, release, runtime.channel, runtime.companionAvailable]);
  useEffect(() => {
    if (runtime.channel !== "npm" || !runtime.companionAvailable || !companionBaseUrl || localBootstrapStarted.current) return;
    localBootstrapStarted.current = true;
    const bootstrap = async () => {
      setStatus({ state: "checking", message: "Starting the local session..." });
      try {
        await requestJson(window.location.origin + "/__dusk/bootstrap", {
          init: { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" },
          timeoutMs: 2_500,
          maxBytes: 4 * 1024,
          validate: isPairingResult
        });
        await refresh();
      } catch (error) {
        setStatus({ state: "unavailable", message: safeRequestMessage(error) });
      }
    };
    void bootstrap();
  }, [companionBaseUrl, refresh, runtime.channel, runtime.companionAvailable]);
  return [status, refresh];
}

type JourneyAction =
  | { type: "record"; path: BuilderPath; route: StepRoute; evidence: EvidenceCode[]; options?: RecordEvidenceOptions }
  | { type: "remove-evidence"; path: BuilderPath; route: StepRoute; evidence: EvidenceCode[] }
  | { type: "block"; path: BuilderPath; route: StepRoute; blocker: BlockerCode }
  | { type: "skip"; path: BuilderPath; route: StepRoute; blocker: BlockerCode }
  | { type: "resume"; path: BuilderPath; route: StepRoute }
  | { type: "invalidate"; path: BuilderPath; route: StepRoute }
  | { type: "reset" };

function journeyReducer(state: JourneyProgressState, action: JourneyAction): JourneyProgressState {
  switch (action.type) {
    case "record": return recordJourneyEvidence(state, action.path, action.route, action.evidence, action.options);
    case "remove-evidence": return removeJourneyEvidence(state, action.path, action.route, action.evidence);
    case "block": return blockJourneyStep(state, action.path, action.route, action.blocker);
    case "skip": return skipJourneyStep(state, action.path, action.route, action.blocker);
    case "resume": return resumeJourneyStep(state, action.path, action.route);
    case "invalidate": return invalidateJourneyFrom(state, action.path, action.route);
    case "reset": return createInitialJourneyProgress();
  }
}

export interface JourneyController {
  progress: JourneyProgressState;
  record: (path: BuilderPath, route: StepRoute, evidence: EvidenceCode[], options?: RecordEvidenceOptions) => void;
  removeEvidence: (path: BuilderPath, route: StepRoute, evidence: EvidenceCode[]) => void;
  block: (path: BuilderPath, route: StepRoute, blocker: BlockerCode) => void;
  skip: (path: BuilderPath, route: StepRoute, blocker: BlockerCode) => void;
  resume: (path: BuilderPath, route: StepRoute) => void;
  invalidate: (path: BuilderPath, route: StepRoute) => void;
  reset: () => void;
}

const JourneyContext = createContext<JourneyController | undefined>(undefined);

export function JourneyProvider({ children }: { children: ReactNode }) {
  const [progress, dispatch] = useReducer(journeyReducer, undefined, () => parseJourneyProgress(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)));
  useEffect(() => window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress)), [progress]);
  const value: JourneyController = {
    progress,
    record: (path, route, evidence, options) => dispatch({ type: "record", path, route, evidence, options }),
    removeEvidence: (path, route, evidence) => dispatch({ type: "remove-evidence", path, route, evidence }),
    block: (path, route, blocker) => dispatch({ type: "block", path, route, blocker }),
    skip: (path, route, blocker) => dispatch({ type: "skip", path, route, blocker }),
    resume: (path, route) => dispatch({ type: "resume", path, route }),
    invalidate: (path, route) => dispatch({ type: "invalidate", path, route }),
    reset: () => dispatch({ type: "reset" })
  };
  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyController {
  const value = useContext(JourneyContext);
  if (!value) throw new Error("Journey context is missing.");
  return value;
}
