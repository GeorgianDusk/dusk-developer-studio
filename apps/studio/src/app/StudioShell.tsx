import { ArrowRight, CheckCircle2, Gauge } from "lucide-react";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { STUDIO_RELEASE_LABEL } from "../release";
import {
  STEP_ROUTES,
  getJourneyCompletionCounts,
  getJourneyStatusLabel,
  getStepRequirements,
  isJourneyComplete,
  type BuilderPath,
  type StepRoute
} from "./journeyProgress";
import { blockerLabels, evidenceLabels, pathText, steps } from "./studioConfig";
import { getDuskDsDeployReadiness } from "./deployReadiness";
import { useJourney, useStudioRuntime } from "./studioState";
import { ExternalLink, StatusPill, toneForStatus } from "./StudioUi";
import type { CompanionStatus, RouteId } from "./types";

export function Shell({ route, setRoute, builderPath, companionStatus, children }: { route: RouteId; setRoute: (route: RouteId) => void; builderPath: BuilderPath | null; companionStatus: CompanionStatus; children: ReactNode }) {
  const { runtime: studioRuntime } = useStudioRuntime();
  const { progress } = useJourney();
  const completion = builderPath ? getJourneyCompletionCounts(progress, builderPath) : null;
  const showJourneyContext = Boolean(builderPath && route !== "overview" && !(builderPath === "evm" && route === "reference"));
  const storedGuideRoute = window.sessionStorage.getItem("dusk-studio-last-guide-route");
  const lastGuideRoute = STEP_ROUTES.includes(route as StepRoute)
    ? route as StepRoute
    : STEP_ROUTES.includes(storedGuideRoute as StepRoute)
      ? storedGuideRoute as StepRoute
      : null;
  useEffect(() => {
    if (STEP_ROUTES.includes(route as StepRoute)) {
      window.sessionStorage.setItem("dusk-studio-last-guide-route", route);
    }
  }, [route]);
  const resumeRoute = builderPath
    ? STEP_ROUTES.find((step) => {
        const status = progress.paths[builderPath][step].status;
        return !isJourneyComplete(status) && status !== "skipped" && status !== "skipped-with-reason";
      }) ?? "inspect"
    : "setup";
  const supportRoute = route === "reference" || route === "troubleshooting" || route === "companion" || route === "settings";
  const contextRoute = supportRoute && lastGuideRoute ? lastGuideRoute : resumeRoute;
  const contextLabel = steps[builderPath ?? "duskds"].find((step) => step.id === contextRoute)?.label ?? "Setup";
  const contextVerb = supportRoute && lastGuideRoute ? "Return to" : "Resume";
  const localRuntimeState = !studioRuntime.companionAvailable
    ? "Manual guide"
    : companionStatus.state === "available"
      ? companionStatus.capabilitiesEnabled ? "Actions ready" : "Safe mode"
      : companionStatus.state === "mismatch"
        ? "Mismatch"
        : companionStatus.state === "checking" ? "Checking" : "Not connected";
  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    document.getElementById("studio-main")?.focus();
  }
  return (
    <div className={"app-shell route-" + route}>
      <a className="skip-link" href="#studio-main" onClick={skipToContent}>Skip to main content</a>
      <header className="studio-header">
        <button className="brand-button" type="button" onClick={() => setRoute("overview")} aria-label="Dusk Developer Studio home">
          <span className="brand-mark">D</span>
          <strong>Developer Studio<small>BUILD / CHECK</small></strong>
        </button>
        <nav className="top-nav" aria-label="Studio navigation">
          <button className={route === "overview" ? "active" : ""} type="button" aria-current={route === "overview" ? "page" : undefined} onClick={() => setRoute("overview")}><Gauge size={15} />Paths</button>
          <button className={route === "reference" ? "active" : ""} aria-current={route === "reference" ? "page" : undefined} type="button" onClick={() => setRoute("reference")}>Reference</button>
          <button className={route === "troubleshooting" ? "active" : ""} aria-current={route === "troubleshooting" ? "page" : undefined} type="button" onClick={() => setRoute("troubleshooting")}>Troubleshoot</button>
          <button className={route === "companion" ? "active local-tools-button" : "local-tools-button"} aria-label={"Automation: " + localRuntimeState} aria-current={route === "companion" ? "page" : undefined} type="button" onClick={() => setRoute("companion")}><span>Automation</span><small>{localRuntimeState}</small></button>
        </nav>
        {showJourneyContext && builderPath ? (
          <button className="journey-context" type="button" aria-label={builderPath === "evm" ? "Return to DuskEVM pre-launch reference" : `${contextVerb} ${pathText[builderPath].label} at ${contextLabel}`} onClick={() => setRoute(builderPath === "evm" ? "reference" : contextRoute)}>
            <span>{builderPath === "evm" ? "DuskEVM pre-launch" : `${contextVerb} ${pathText[builderPath].label} · ${contextLabel}`}</span>
            <strong>
              <span className="state-sprite" aria-hidden="true" />
              {builderPath === "evm"
                ? "Return to reference"
                : `${completion?.completed ?? 0}/4 complete · ${completion?.automatic ?? 0} automatic · ${completion?.manual ?? 0} manual`}
            </strong>
          </button>
        ) : null}
      </header>
      <main className="studio-main" id="studio-main" tabIndex={-1}>{children}</main>
      <footer className="studio-footer">
        <span>Independent community project</span>
        <span>{STUDIO_RELEASE_LABEL}</span>
        <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio/issues">Support</ExternalLink>
        <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio">Source</ExternalLink>
        <button type="button" onClick={() => setRoute("settings")}>Build & browser data</button>
      </footer>
    </div>
  );
}

function WorkstationScene() {
  return <div className="workstation-scene" aria-hidden="true"><div className="scene-hud"><span>LOCAL WORKSTATION</span><strong>NIGHT SHIFT / TESTNET</strong></div><div className="pixel-stage"><span className="pixel-window" /><span className="pixel-desk" /><span className="pixel-crt"><span className="pixel-screen"><i /><i /><i /></span></span><span className="pixel-keyboard" /><span className="pixel-operator"><i className="pixel-head" /><i className="pixel-body" /></span><span className="pixel-manual"><i /><i /></span><span className="pixel-cable" /></div><div className="scene-readout"><span>PATH SELECT</span><span>NO SIGNING</span><span>READ / BUILD / CHECK</span></div></div>;
}

export function OverviewPage({ pendingRoute, setBuilderPath, setRoute }: { pendingRoute?: StepRoute | null; setBuilderPath: (path: BuilderPath) => void; setRoute: (route: RouteId) => void }) {
  const { progress } = useJourney();
  const pendingStep = pendingRoute ? steps.evm.find((step) => step.id === pendingRoute) : undefined;
  const previewSteps = [
    ["1", "Setup", "Follow the reviewed prerequisites manually."],
    ["2", "Access", "Run a read-only query and record what you observed."],
    ["3", "Build", "Create and test locally; automation is optional."],
    ["4", "Inspect", "Review pre-deploy evidence, deploy manually, then verify read-only results."]
  ];
  return (
    <section className="overview-page">
      <div className="mission-intro">
        <div className="hero-copy">
          <span className="section-kicker">Choose your path</span>
          <h1 data-route-heading tabIndex={-1}>{pendingStep ? `Choose a path to continue to ${pendingStep.label}.` : "Pick the execution model your app actually needs."}</h1>
          <p>{pendingStep
            ? `Choose DuskDS to continue to ${pendingStep.label}. DuskEVM opens its single pre-launch reference because live tasks are not active yet.`
            : "Hosted Studio can guide you, provide reviewed commands, and record manual confirmations. It cannot inspect your machine or create files. DuskDS is usable manually today; DuskEVM is a single pre-launch reference."}</p>
          <div className="mission-flags">
            <span className="active"><i aria-hidden="true" />DUSKDS MANUAL GUIDE AVAILABLE</span>
            <span className="preview"><i aria-hidden="true" />DUSKEVM PRE-LAUNCH REFERENCE</span>
            <span className="docs-only"><i aria-hidden="true" />HOSTED · NO MACHINE ACCESS</span>
          </div>
        </div>
        <WorkstationScene />
      </div>
      <div className="path-cards" aria-label="Choose a builder path">
        {(["evm", "duskds"] as BuilderPath[]).map((path) => {
          const counts = getJourneyCompletionCounts(progress, path);
          const hasActivity = Object.values(progress.paths[path]).some((step) => step.evidence.length > 0 || Boolean(step.blocker) || step.status === "skipped" || step.status === "skipped-with-reason");
          const availabilityId = `path-${path}-availability`;
          const summaryId = `path-${path}-summary`;
          const resultId = `path-${path}-result`;
          const progressId = `path-${path}-progress`;
          return (
            <button
              key={path}
              type="button"
              className={"path-card path-card-" + path}
              aria-label={`${pathText[path].label}. ${pathText[path].start}`}
              aria-describedby={`${availabilityId} ${summaryId} ${resultId} ${progressId}`}
              onClick={() => {
                setBuilderPath(path);
                setRoute(path === "evm" ? "reference" : pendingRoute ?? "setup");
              }}
            >
              <span className="path-card-code">{path === "evm" ? "CAMPAIGN EVM_01" : "CAMPAIGN DS_02"}</span>
              <span className="path-card-availability" id={availabilityId}>
                <StatusPill tone={pathText[path].availabilityTone}>{pathText[path].availability}</StatusPill>
                <small>{pathText[path].availabilityCopy}</small>
              </span>
              <span className="path-card-eyebrow">{pathText[path].eyebrow}</span>
              <strong>{pathText[path].label}</strong>
              <p id={summaryId}>{pathText[path].summary}</p>
              <span className="path-card-result" id={resultId}><span>First useful result</span>{pathText[path].result}</span>
              <span className="path-card-progress" id={progressId}><span className="state-sprite" aria-hidden="true" />{path === "evm" ? "One pre-launch reference · no completion score" : `${counts.completed}/4 complete · ${counts.automatic} automatic · ${counts.manual} manual · ${hasActivity ? "progress saved" : "not started"}`}</span>
              <em>{pathText[path].start}<ArrowRight size={16} /></em>
            </button>
          );
        })}
      </div>
      <div className="path-comparison-wrap">
        <table className="path-comparison">
          <caption>Quick comparison of the two Dusk builder paths</caption>
          <thead><tr><th scope="col">Decision</th><th scope="col">DuskEVM</th><th scope="col">DuskDS</th></tr></thead>
          <tbody>
            <tr><th scope="row">Status</th><td>Single pre-launch reference; no completion score</td><td>Manual guide available now</td></tr>
            <tr><th scope="row">What can I do today?</th><td>Review the planned architecture, tooling, and launch requirements</td><td>Check prerequisites, run read-only queries, build locally, and record manual results</td></tr>
            <tr><th scope="row">Requires local software?</th><td>No for the pre-launch reference</td><td>Yes for commands and builds; hosted Studio itself never accesses your machine</td></tr>
            <tr><th scope="row">Language</th><td>Solidity</td><td>Rust + WASM</td></tr>
            <tr><th scope="row">Execution</th><td>EVM compatibility</td><td>Native DuskVM</td></tr>
            <tr><th scope="row">Tooling</th><td>Foundry / EVM wallets</td><td>Dusk Forge / W3sper</td></tr>
            <tr><th scope="row">Privacy fit</th><td>Hedger is reference-only</td><td>Native privacy-aware building blocks</td></tr>
            <tr><th scope="row">Choose when</th><td>You are preparing for DuskEVM launch</td><td>You need native Dusk capabilities now</td></tr>
          </tbody>
        </table>
      </div>
      <section className="journey-preview" aria-labelledby="journey-preview-title">
        <div className="result-brief">
          <span className="section-kicker">After you choose</span>
          <h2 id="journey-preview-title">DuskDS uses four practical stages.</h2>
          <p>DuskEVM stays one pre-launch reference until its live developer workflow is reviewed and activated.</p>
        </div>
        <ol>{previewSteps.map(([number, label, copy]) => <li key={number}><span>{number}</span><strong>{label}</strong><small>{copy}</small></li>)}</ol>
      </section>
    </section>
  );
}

export function FlowRail({ builderPath, activeRoute, setRoute }: { builderPath: BuilderPath; activeRoute: RouteId; setRoute: (route: RouteId) => void }) {
  const { progress } = useJourney();
  return <ol className="flow-rail" aria-label={pathText[builderPath].label + " guide sequence"}>{steps[builderPath].map((step) => { const status = progress.paths[builderPath][step.id].status; const statusLabel = getJourneyStatusLabel(status); return <li key={step.id} className={activeRoute === step.id ? "active" : ""}><button type="button" aria-label={`${step.number} ${step.label}: ${step.title} (${statusLabel})`} aria-current={activeRoute === step.id ? "step" : undefined} onClick={() => setRoute(step.id)}><span className="step-number">{step.number}</span><strong>{step.label}</strong><small>{step.title}</small><StatusPill tone={toneForStatus(status)}>{statusLabel}</StatusPill></button></li>; })}</ol>;
}

export function StepFrame({ builderPath, route, setRoute, children, helper }: { builderPath: BuilderPath; route: StepRoute; setRoute: (route: RouteId) => void; children: ReactNode; helper?: ReactNode }) {
  const journey = useJourney();
  const current = steps[builderPath].find((step) => step.id === route) ?? steps[builderPath][0];
  const index = steps[builderPath].findIndex((step) => step.id === route);
  const previous = steps[builderPath][index - 1];
  const next = steps[builderPath][index + 1];
  const progress = journey.progress.paths[builderPath][route];
  const required = getStepRequirements(builderPath, route);
  const completion = getJourneyCompletionCounts(journey.progress, builderPath);
  const deployReadiness = builderPath === "duskds"
    ? getDuskDsDeployReadiness(journey.progress)
    : null;
  const announcement = useRef<HTMLSpanElement>(null);
  const previousProgress = useRef({ status: progress.status, evidenceCount: progress.evidence.length });
  function reviewDeployReadiness() {
    const target = document.getElementById("duskds-deploy-readiness");
    target?.scrollIntoView({ block: "start" });
    target?.focus();
  }
  function reviewPostDeployInspection() {
    const target = document.getElementById("duskds-post-deploy-inspection");
    target?.scrollIntoView({ block: "start" });
    target?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const previous = previousProgress.current;
    let message = "";
    if (previous.status !== progress.status || previous.evidenceCount !== progress.evidence.length) {
      if (isJourneyComplete(progress.status)) message = `${pathText[builderPath].label} ${current.label} ${getJourneyStatusLabel(progress.status).toLowerCase()}. ${completion.completed} of 4 journey steps complete: ${completion.automatic} automatic and ${completion.manual} manual.`;
      else if (progress.status === "skipped" || progress.status === "skipped-with-reason") message = `${pathText[builderPath].label} ${current.label} skipped for now.`;
      else if (progress.evidence.length > previous.evidenceCount) message = `Evidence recorded for ${pathText[builderPath].label} ${current.label}: ${progress.evidence.length} of ${required.length} required observations.`;
    }
    if (announcement.current) announcement.current.textContent = message;
    previousProgress.current = { status: progress.status, evidenceCount: progress.evidence.length };
  }, [builderPath, completion.automatic, completion.completed, completion.manual, current.label, progress.evidence.length, progress.status, required.length]);
  return (
    <section className="guide-page">
      <FlowRail builderPath={builderPath} activeRoute={route} setRoute={setRoute} />
      <article className="step-sheet">
        <div className="step-heading">
          <div className="step-heading-meta">
            <span>{pathText[builderPath].label} step {current.number}</span>
            <StatusPill tone={pathText[builderPath].availabilityTone}>{pathText[builderPath].availability}</StatusPill>
          </div>
          <h1 data-route-heading tabIndex={-1}>{current.title}</h1>
          <p>{current.intent}</p>
          <p className={"journey-availability-note " + builderPath}>{pathText[builderPath].availabilityCopy}</p>
        </div>
        <span ref={announcement} className="sr-only journey-announcement" role="status" aria-live="polite" aria-atomic="true" />
        {children}
      </article>
      <aside className="done-panel">
        <div className="button-row">
          <span className="section-kicker">Evidence</span>
          <StatusPill tone={toneForStatus(progress.status)}>{getJourneyStatusLabel(progress.status)}</StatusPill>
        </div>
        <ul className="evidence-list">
          {required.map((item) => {
            const entry = progress.evidenceEntries.find((candidate) => candidate.code === item);
            return (
              <li key={item} className={entry ? "observed" : "missing"}>
                {entry ? <CheckCircle2 size={15} aria-hidden="true" /> : <span className="evidence-marker" aria-hidden="true" />}
                <span>
                  {evidenceLabels[item]}
                  {entry ? <small>{entry.method === "automatic" ? "Automatic check" : "Manual confirmation"} · {new Date(entry.observedAt).toLocaleString()}</small> : <small>Not checked</small>}
                </span>
              </li>
            );
          })}
        </ul>
        {progress.status === "blocked" && progress.blocker ? <p className="blocker-note">Current blocker: {blockerLabels[progress.blocker]}.</p> : null}
        <span className="section-kicker">Done when</span>
        <ul>{current.done.map((item) => <li key={item}>{item}</li>)}</ul>
        {helper ? <div className="helper-slot">{helper}</div> : null}
        {progress.status === "skipped" || progress.status === "skipped-with-reason"
          ? <button type="button" className="skip-button" onClick={() => journey.resume(builderPath, route)}>Resume this step</button>
          : <button type="button" className="skip-button" onClick={() => journey.skip(builderPath, route, progress.blocker ?? "user-deferred")}>Skip for now</button>}
        <div className="step-actions">
          {previous ? <button type="button" onClick={() => setRoute(previous.id)}>Back: {previous.label}</button> : null}
          {next
            ? <button type="button" className="primary-button" onClick={() => setRoute(next.id)}>Next: {next.label}</button>
            : builderPath === "duskds"
              ? !deployReadiness?.evidenceReady
                ? <button type="button" className="primary-button" onClick={reviewDeployReadiness}>Review deployment readiness</button>
                : !isJourneyComplete(progress.status)
                  ? <button type="button" className="primary-button" onClick={reviewPostDeployInspection}>Continue to post-deploy inspection</button>
                  : <button type="button" className="primary-button" onClick={() => setRoute("reference")}>Open reference</button>
              : <button type="button" className="primary-button" onClick={() => setRoute("reference")}>Open reference</button>}
        </div>
      </aside>
    </section>
  );
}

export function CompanionActionButton({ companionStatus, setRoute, onAction, children, disabled = false }: { companionStatus: CompanionStatus; setRoute: (route: RouteId) => void; onAction: () => void | Promise<void>; children: ReactNode; disabled?: boolean }) {
  const { runtime: studioRuntime } = useStudioRuntime();
  if (!studioRuntime.companionAvailable) return <button className="primary-button" type="button" onClick={() => setRoute("companion")}>See manual and automation options</button>;
  if (companionStatus.state === "mismatch") return <button className="primary-button" type="button" onClick={() => setRoute("companion")}>Resolve local release mismatch</button>;
  if (companionStatus.state !== "available") return <button className="primary-button" type="button" onClick={() => setRoute("companion")} disabled={companionStatus.state === "checking"}>{companionStatus.state === "checking" ? "Checking companion" : "Set up local companion"}</button>;
  if (!companionStatus.capabilitiesEnabled) return <button className="primary-button" type="button" onClick={() => setRoute("companion")}>Enable local capabilities</button>;
  return <button className="primary-button" type="button" disabled={disabled} onClick={onAction}>{children}</button>;
}
