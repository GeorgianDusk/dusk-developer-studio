import { useEffect, useLayoutEffect, useRef } from "react";
import { STUDIO_RELEASE, type StudioRelease } from "../release";
import { STEP_ROUTES, type StepRoute } from "./journeyProgress";
import type { StudioRuntime } from "./runtime";
import { studioRuntime } from "./studioConfig";
import { getRouteScrollY, JourneyProvider, restoreRouteFocus, RuntimeProvider, useBuilderPath, useCompanionStatus, useRoute } from "./studioState";
import { OverviewPage, Shell } from "./StudioShell";
import { AccessPage, BuildPage, InspectPage, SetupPage } from "./routes/GuideRoutes";
import { ReferencePage, TroubleshootingPage } from "./routes/ReferenceRoutes";
import { LocalCompanionPage, SettingsPage } from "./routes/SystemRoutes";

function StudioRoutes() {
  const [route, setRoute, routeNavigation] = useRoute();
  const [builderPath, setBuilderPath] = useBuilderPath();
  const [companionStatus, refreshCompanion] = useCompanionStatus();
  const isGuideRoute = STEP_ROUTES.includes(route as StepRoute);
  const pendingGuideRoute = isGuideRoute && builderPath === null ? route as StepRoute : null;
  const evmCanonicalRoute = builderPath === "evm" && isGuideRoute && route !== "setup" ? "setup" : null;
  const visibleRoute = pendingGuideRoute ? "overview" : evmCanonicalRoute ?? route;
  const activeBuilderPath = builderPath ?? "evm";
  const shellBuilderPath = visibleRoute === "overview" ? null : isGuideRoute ? activeBuilderPath : builderPath;
  const previousView = useRef<string | null>(null);
  useEffect(() => {
    if (evmCanonicalRoute) setRoute(evmCanonicalRoute, { replace: true });
  }, [evmCanonicalRoute, setRoute]);
  useLayoutEffect(() => {
    const heading = document.querySelector<HTMLElement>("[data-route-heading]");
    if (heading) {
      document.title = `${heading.textContent?.trim() || "Developer Studio"} | Dusk Developer Studio`;
      const view = `${visibleRoute}:${builderPath ?? "no-path"}:${pendingGuideRoute ?? "none"}`;
      const changed = previousView.current !== null && previousView.current !== view;
      previousView.current = view;
      window.scrollTo({ top: getRouteScrollY(), left: 0, behavior: "auto" });
      if (changed) {
        if (routeNavigation.kind === "history") {
          if (!restoreRouteFocus()) heading.focus({ preventScroll: true });
        } else {
          heading.focus({ preventScroll: true });
        }
      }
    }
  }, [builderPath, companionStatus.state, pendingGuideRoute, routeNavigation.kind, routeNavigation.sequence, visibleRoute]);
  return <Shell route={visibleRoute} setRoute={setRoute} builderPath={shellBuilderPath} companionStatus={companionStatus}>
    {visibleRoute === "overview" && <OverviewPage pendingRoute={pendingGuideRoute} setBuilderPath={setBuilderPath} setRoute={setRoute} />}
    {!pendingGuideRoute && visibleRoute === "setup" && <SetupPage builderPath={activeBuilderPath} companionStatus={companionStatus} setRoute={setRoute} />}
    {!pendingGuideRoute && visibleRoute === "access" && <AccessPage builderPath={activeBuilderPath} setRoute={setRoute} />}
    {!pendingGuideRoute && visibleRoute === "build" && <BuildPage builderPath={activeBuilderPath} companionStatus={companionStatus} setRoute={setRoute} />}
    {!pendingGuideRoute && visibleRoute === "inspect" && <InspectPage builderPath={activeBuilderPath} setRoute={setRoute} />}
    {route === "reference" && <ReferencePage builderPath={builderPath} />}
    {route === "troubleshooting" && <TroubleshootingPage builderPath={builderPath} setBuilderPath={setBuilderPath} setRoute={setRoute} />}
    {route === "companion" && <LocalCompanionPage companionStatus={companionStatus} refreshCompanion={refreshCompanion} />}
    {route === "settings" && <SettingsPage builderPath={builderPath} setBuilderPath={setBuilderPath} />}
  </Shell>;
}

export function App({ runtime = studioRuntime, release = STUDIO_RELEASE }: { runtime?: StudioRuntime; release?: StudioRelease }) {
  return <RuntimeProvider runtime={runtime} release={release}><JourneyProvider><StudioRoutes /></JourneyProvider></RuntimeProvider>;
}
