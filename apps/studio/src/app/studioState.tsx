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
import { isCompanionHealth, isPairingResult, type CompanionHealth } from "./responseSchemas";
import { hasLocalReleaseParity, type StudioRuntime } from "./runtime";
import { requestJson, safeRequestMessage, SafeRequestError } from "./safeRequest";
import { localAgentUrl, studioRuntime } from "./studioConfig";
import type { CompanionStatus, RouteId } from "./types";

const routeIds: RouteId[] = ["overview", "setup", "access", "build", "inspect", "reference", "troubleshooting", "companion", "settings"];
const ROUTE_SCROLL_STATE_KEY = "duskStudioScrollY";
const ROUTE_FOCUS_STATE_KEY = "duskStudioFocus";
const ROUTE_BUILDER_PATH_STATE_KEY = "duskStudioBuilderPath";
const ROUTE_BUILDER_PATH_GENERATION_STATE_KEY = "duskStudioBuilderPathGeneration";
const ROUTE_BUILDER_PATH_GENERATION_STORAGE_KEY = "dusk-studio-builder-path-generation";
let volatileBuilderPathGeneration = 0;

interface RouteFocusSnapshot {
  path: number[];
}

type RouteNavigationKind = "initial" | "push" | "replace" | "history" | "hash";

export interface RouteNavigation {
  kind: RouteNavigationKind;
  sequence: number;
}

const routeFocusableSelector = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function focusCandidates(): HTMLElement[] {
  const root = document.getElementById("studio-app-shell");
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(routeFocusableSelector)).filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
}

function captureRouteFocus(): RouteFocusSnapshot | null {
  const active = document.activeElement;
  const root = document.getElementById("studio-app-shell");
  if (!(active instanceof HTMLElement) || !(root instanceof HTMLElement) || !root.contains(active)) return null;
  const path: number[] = [];
  let current: HTMLElement | null = active;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    if (path.length > 32) return null;
    current = parent;
  }
  return current === root && path.length > 0 ? { path } : null;
}

function routeFocusSnapshot(): RouteFocusSnapshot | null {
  const value = window.history.state?.[ROUTE_FOCUS_STATE_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<RouteFocusSnapshot>;
  if (!Array.isArray(candidate.path)
    || candidate.path.length === 0
    || candidate.path.length > 32
    || candidate.path.some((index) => !Number.isSafeInteger(index) || index < 0 || index > 4096)
  ) return null;
  return candidate as RouteFocusSnapshot;
}

function resolveRouteFocus(snapshot: RouteFocusSnapshot): HTMLElement | null {
  let current: Element | null = document.getElementById("studio-app-shell");
  for (const index of snapshot.path) current = current?.children.item(index) ?? null;
  return current instanceof HTMLElement ? current : null;
}

function currentBuilderPathGeneration(): number {
  try {
    const value = Number(window.sessionStorage.getItem(ROUTE_BUILDER_PATH_GENERATION_STORAGE_KEY));
    if (Number.isSafeInteger(value) && value >= 0) {
      volatileBuilderPathGeneration = value;
      return value;
    }
  } catch {
    // The in-memory generation still protects this tab when session storage is disabled.
  }
  return volatileBuilderPathGeneration;
}

export function invalidatePriorBuilderPathHistory(): void {
  const next = currentBuilderPathGeneration() + 1;
  volatileBuilderPathGeneration = next;
  try {
    window.sessionStorage.setItem(ROUTE_BUILDER_PATH_GENERATION_STORAGE_KEY, String(next));
  } catch {
    // The in-memory generation remains authoritative for this mounted tab.
  }
}

function historyStateWithScroll(scrollY: number): Record<string, unknown> {
  const state = window.history.state;
  const base = state !== null && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return { ...base, [ROUTE_SCROLL_STATE_KEY]: Math.max(0, scrollY) };
}

function replaceRouteScroll(scrollY: number): void {
  window.history.replaceState(historyStateWithScroll(scrollY), "", window.location.href);
}

function replaceRouteNavigationSnapshot(scrollY: number): void {
  window.history.replaceState({
    ...historyStateWithScroll(scrollY),
    [ROUTE_FOCUS_STATE_KEY]: captureRouteFocus()
  }, "", window.location.href);
}

function historyStateWithBuilderPath(path: BuilderPath | null): Record<string, unknown> {
  const state = window.history.state;
  const base = state !== null && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return {
    ...base,
    [ROUTE_BUILDER_PATH_STATE_KEY]: path,
    [ROUTE_BUILDER_PATH_GENERATION_STATE_KEY]: currentBuilderPathGeneration()
  };
}

function replaceRouteBuilderPath(path: BuilderPath | null): void {
  window.history.replaceState(historyStateWithBuilderPath(path), "", window.location.href);
}

function getRouteBuilderPath(): BuilderPath | null | undefined {
  const value = window.history.state?.[ROUTE_BUILDER_PATH_STATE_KEY];
  const stateGeneration = window.history.state?.[ROUTE_BUILDER_PATH_GENERATION_STATE_KEY];
  const currentGeneration = currentBuilderPathGeneration();
  const generationMatches = stateGeneration === currentGeneration
    || (stateGeneration === undefined && currentGeneration === 0);
  if (generationMatches && (value === "evm" || value === "duskds" || value === null)) return value;
  return undefined;
}

export function getRouteScrollY(): number {
  const value = window.history.state?.[ROUTE_SCROLL_STATE_KEY];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function restoreRouteFocus(): boolean {
  const snapshot = routeFocusSnapshot();
  const candidates = focusCandidates();
  const resolved = snapshot ? resolveRouteFocus(snapshot) : null;
  const visible = (candidate: HTMLElement): boolean => {
    const rect = candidate.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  };
  const matched = resolved && candidates.includes(resolved) && visible(resolved) ? resolved : undefined;
  const main = document.getElementById("studio-main");
  const target = matched
    ?? candidates.find((candidate) => Boolean(main?.contains(candidate)) && visible(candidate))
    ?? candidates.find(visible);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target && visible(target);
}

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

export function useRoute(): [RouteId, (route: RouteId, options?: { replace?: boolean }) => void, RouteNavigation] {
  const [route, setRouteState] = useState<RouteId>(getInitialRoute);
  const [navigation, setNavigation] = useState<RouteNavigation>({ kind: "initial", sequence: 0 });
  const advanceNavigation = useCallback((kind: RouteNavigationKind) => {
    setNavigation((current) => ({ kind, sequence: current.sequence + 1 }));
  }, []);
  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    if (window.history.state?.[ROUTE_SCROLL_STATE_KEY] === undefined) replaceRouteScroll(window.scrollY);
    let popstateHref: string | null = null;
    const syncRoute = (kind: RouteNavigationKind) => {
      const next = getInitialRoute();
      const raw = window.location.hash.replace(/^#\/?/, "");
      if (raw && raw !== next) window.history.replaceState(window.history.state, "", `#${next}`);
      if (window.history.state?.[ROUTE_SCROLL_STATE_KEY] === undefined) replaceRouteScroll(0);
      setRouteState(next);
      if (kind !== "initial") advanceNavigation(kind);
    };
    const onPopState = () => {
      popstateHref = window.location.href;
      syncRoute("history");
    };
    const onHashChange = () => {
      if (popstateHref === window.location.href) {
        popstateHref = null;
        return;
      }
      syncRoute("hash");
    };
    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        replaceRouteScroll(window.scrollY);
      });
    };
    const onFocus = () => replaceRouteNavigationSnapshot(window.scrollY);
    syncRoute("initial");
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      replaceRouteScroll(window.scrollY);
      window.history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocus);
    };
  }, [advanceNavigation]);
  const setRoute = useCallback((next: RouteId, options?: { replace?: boolean }) => {
    const current = getInitialRoute();
    if (current !== next) {
      replaceRouteNavigationSnapshot(window.scrollY);
      const state = { ...historyStateWithScroll(0), [ROUTE_FOCUS_STATE_KEY]: null };
      if (options?.replace) window.history.replaceState(state, "", `#${next}`);
      else window.history.pushState(state, "", `#${next}`);
      advanceNavigation(options?.replace ? "replace" : "push");
    }
    setRouteState(next);
  }, [advanceNavigation]);
  return [route, setRoute, navigation];
}

export function useBuilderPath(): [BuilderPath | null, (path: BuilderPath | null) => void] {
  const [path, setPath] = useState<BuilderPath | null>(() => {
    const historyPath = getRouteBuilderPath();
    if (historyPath !== undefined) return historyPath;
    const storedPath = window.localStorage.getItem("dusk-studio-builder-path");
    return storedPath === "evm" || storedPath === "duskds" ? storedPath : null;
  });
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  useEffect(() => {
    if (getRouteBuilderPath() === undefined) replaceRouteBuilderPath(pathRef.current);
    const onHistory = () => {
      let next = getRouteBuilderPath();
      if (next === undefined) {
        next = pathRef.current;
        replaceRouteBuilderPath(next);
      }
      if (next) window.localStorage.setItem("dusk-studio-builder-path", next);
      else window.localStorage.removeItem("dusk-studio-builder-path");
      pathRef.current = next;
      setPath(next);
    };
    window.addEventListener("hashchange", onHistory);
    window.addEventListener("popstate", onHistory);
    return () => {
      window.removeEventListener("hashchange", onHistory);
      window.removeEventListener("popstate", onHistory);
    };
  }, []);
  const setBuilderPath = useCallback((next: BuilderPath | null) => {
    if (next) window.localStorage.setItem("dusk-studio-builder-path", next);
    else window.localStorage.removeItem("dusk-studio-builder-path");
    replaceRouteBuilderPath(next);
    pathRef.current = next;
    setPath(next);
  }, []);
  return [path, setBuilderPath];
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
  const readHealth = useCallback(async (): Promise<CompanionHealth> => {
    if (!companionBaseUrl) throw new SafeRequestError("unavailable", "The local companion is unavailable.", true);
    return requestJson(companionBaseUrl + "/health", {
      init: { credentials: "include" }, timeoutMs: 1_200, validate: isCompanionHealth
    });
  }, [companionBaseUrl]);
  const applyHealth = useCallback((data: CompanionHealth) => {
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
  }, [release, runtime.channel]);
  const refresh = useCallback(async () => {
    if (!runtime.companionAvailable || !companionBaseUrl) {
      setStatus({ state: "unavailable", message: "Open the Studio locally to check the companion. The hosted site never runs machine actions." });
      return;
    }
    setStatus({ state: "checking", message: "Checking local companion..." });
    try {
      applyHealth(await readHealth());
    } catch (error) {
      setStatus({ state: "unavailable", message: safeRequestMessage(error) });
    }
  }, [applyHealth, companionBaseUrl, readHealth, runtime.companionAvailable]);
  useEffect(() => {
    if (runtime.channel !== "npm" || !runtime.companionAvailable || !companionBaseUrl || localBootstrapStarted.current) return;
    localBootstrapStarted.current = true;
    const bootstrap = async () => {
      setStatus({ state: "checking", message: "Starting the local session..." });
      try {
        try {
          applyHealth(await readHealth());
          return;
        } catch (error) {
          if (!(error instanceof SafeRequestError) || error.status !== 401) {
            setStatus({ state: "unavailable", message: safeRequestMessage(error) });
            return;
          }
        }
        await requestJson(window.location.origin + "/__dusk/bootstrap", {
          init: { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" },
          timeoutMs: 6_500,
          maxBytes: 4 * 1024,
          validate: isPairingResult
        });
        await refresh();
      } catch (error) {
        if (error instanceof SafeRequestError && (error.status === 409 || error.status === 410)) {
          try {
            applyHealth(await readHealth());
            return;
          } catch {
            setStatus({
              state: "unavailable",
              message: "This Local Studio launch is already paired in another browser profile or its five-minute pairing window expired. Close local Studio pages, stop the npm command with Ctrl+C, and rerun it. To choose a specific profile, add --no-open and open http://127.0.0.1:5173/#companion in that profile before any other local page."
            });
            return;
          }
        }
        setStatus({ state: "unavailable", message: safeRequestMessage(error) });
      }
    };
    void bootstrap();
  }, [applyHealth, companionBaseUrl, readHealth, refresh, runtime.channel, runtime.companionAvailable]);
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
