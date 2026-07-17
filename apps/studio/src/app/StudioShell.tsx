import { ArrowRight, CheckCircle2, Gauge } from "lucide-react";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { STUDIO_RELEASE_LABEL } from "../release";
import { STEP_ROUTES, countVerifiedSteps, getStepRequirements, type BuilderPath, type StepRoute } from "./journeyProgress";
import { evidenceLabels, pathText, steps } from "./studioConfig";
import { useJourney, useStudioRuntime } from "./studioState";
import { ExternalLink, StatusPill, toneForStatus } from "./StudioUi";
import type { CompanionStatus, RouteId } from "./types";

export function Shell({ route, setRoute, builderPath, companionStatus, children }: { route: RouteId; setRoute: (route: RouteId) => void; builderPath: BuilderPath | null; companionStatus: CompanionStatus; children: ReactNode }) {
  const { runtime: studioRuntime } = useStudioRuntime();
  const { progress } = useJourney();
  const verified = builderPath ? countVerifiedSteps(progress, builderPath) : 0;
  const isGuideRoute = STEP_ROUTES.includes(route as StepRoute);
  const showJourneyContext = Boolean(builderPath && (isGuideRoute || route === "reference" || route === "troubleshooting"));
  const localRuntimeState = !studioRuntime.companionAvailable
    ? "Docs-only"
    : companionStatus.state === "available"
      ? companionStatus.capabilitiesEnabled ? "Actions ready" : "Safe mode"
      : companionStatus.state === "mismatch"
        ? "Mismatch"
        : companionStatus.state === "checking" ? "Checking" : "Set up";
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
          <strong>Developer Studio<small>BUILD / VERIFY</small></strong>
        </button>
        <nav className="top-nav" aria-label="Studio navigation">
          <button className={route === "overview" ? "active" : ""} type="button" aria-current={route === "overview" ? "page" : undefined} onClick={() => setRoute("overview")}><Gauge size={15} />Paths</button>
          <button className={route === "reference" ? "active" : ""} aria-current={route === "reference" ? "page" : undefined} type="button" onClick={() => setRoute("reference")}>Reference</button>
          <button className={route === "troubleshooting" ? "active" : ""} aria-current={route === "troubleshooting" ? "page" : undefined} type="button" onClick={() => setRoute("troubleshooting")}>Troubleshoot</button>
          <button className={route === "companion" ? "active local-tools-button" : "local-tools-button"} aria-label={"Local runtime: " + localRuntimeState} aria-current={route === "companion" ? "page" : undefined} type="button" onClick={() => setRoute("companion")}><span>Local runtime</span><small>{localRuntimeState}</small></button>
        </nav>
        {showJourneyContext && builderPath ? (
          <div className="journey-context" aria-label="Current journey">
            <span>{pathText[builderPath].label} journey</span>
            <strong><span className="state-sprite" aria-hidden="true" />{verified}/4 verified</strong>
          </div>
        ) : null}
      </header>
      <main className="studio-main" id="studio-main" tabIndex={-1}>{children}</main>
      <footer className="studio-footer">
        <span>Independent community project</span>
        <span>{studioRuntime.label}</span>
        <span>DuskDS active · DuskEVM preview</span>
        <span>{STUDIO_RELEASE_LABEL}</span>
        <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio/issues">Support</ExternalLink>
        <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio">Source</ExternalLink>
        <button type="button" onClick={() => setRoute("settings")}>Release & local data</button>
      </footer>
    </div>
  );
}

function WorkstationScene() {
  return <div className="workstation-scene" aria-hidden="true"><div className="scene-hud"><span>LOCAL WORKSTATION</span><strong>NIGHT SHIFT / TESTNET</strong></div><div className="pixel-stage"><span className="pixel-window" /><span className="pixel-desk" /><span className="pixel-crt"><span className="pixel-screen"><i /><i /><i /></span></span><span className="pixel-keyboard" /><span className="pixel-operator"><i className="pixel-head" /><i className="pixel-body" /></span><span className="pixel-manual"><i /><i /></span><span className="pixel-cable" /></div><div className="scene-readout"><span>PATH SELECT</span><span>NO SIGNING</span><span>READ / BUILD / VERIFY</span></div></div>;
}

export function OverviewPage({ pendingRoute, setBuilderPath, setRoute }: { pendingRoute?: StepRoute | null; setBuilderPath: (path: BuilderPath) => void; setRoute: (route: RouteId) => void }) {
  const { progress } = useJourney();
  const pendingStep = pendingRoute ? steps.evm.find((step) => step.id === pendingRoute) : undefined;
  const previewSteps = [
    ["1", "Setup", "Confirm the right network and toolchain."],
    ["2", "Access", "Prove read-only access and Testnet readiness."],
    ["3", "Build", "Create and test a starter on your machine."],
    ["4", "Inspect", "Record evidence and inspect the result."]
  ];
  return (
    <section className="overview-page">
      <div className="mission-intro">
        <div className="hero-copy">
          <span className="section-kicker">Choose your path</span>
          <h1 data-route-heading tabIndex={-1}>{pendingStep ? `Choose a path to continue to ${pendingStep.label}.` : "Pick the execution model your app actually needs."}</h1>
          <p>{pendingStep
            ? `This ${pendingStep.label} link did not specify an execution model. Choose DuskEVM or DuskDS and the Studio will continue to the requested step.`
            : "DuskDS is the active guide. DuskEVM remains open as a pre-launch learning path until its Testnet is live."}</p>
          <div className="mission-flags">
            <span className="active"><i aria-hidden="true" />DUSKDS GUIDE ACTIVE</span>
            <span className="preview"><i aria-hidden="true" />DUSKEVM PRE-LAUNCH</span>
            <span className="docs-only"><i aria-hidden="true" />HOSTED DOCS-ONLY</span>
          </div>
        </div>
        <WorkstationScene />
      </div>
      <div className="path-cards" aria-label="Choose a builder path">
        {(["evm", "duskds"] as BuilderPath[]).map((path) => {
          const verified = countVerifiedSteps(progress, path);
          const hasActivity = Object.values(progress.paths[path]).some((step) => step.evidence.length > 0 || Boolean(step.blocker) || step.status === "verified" || step.status === "skipped-with-reason");
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
                setRoute(pendingRoute ?? "setup");
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
              <span className="path-card-progress" id={progressId}><span className="state-sprite" aria-hidden="true" />{verified}/4 verified · {hasActivity ? "progress saved" : "new journey"}</span>
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
            <tr><th scope="row">Status</th><td>Pre-launch education; live checks deferred</td><td>Active docs + public node guidance</td></tr>
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
          <h2 id="journey-preview-title">One path. Four deliberate stages.</h2>
          <p>The step rail becomes navigation only after you enter a journey.</p>
        </div>
        <ol>{previewSteps.map(([number, label, copy]) => <li key={number}><span>{number}</span><strong>{label}</strong><small>{copy}</small></li>)}</ol>
      </section>
    </section>
  );
}

export function FlowRail({ builderPath, activeRoute, setRoute }: { builderPath: BuilderPath; activeRoute: RouteId; setRoute: (route: RouteId) => void }) {
  const { progress } = useJourney();
  return <ol className="flow-rail" aria-label={pathText[builderPath].label + " guide sequence"}>{steps[builderPath].map((step) => { const status = progress.paths[builderPath][step.id].status; return <li key={step.id} className={activeRoute === step.id ? "active" : ""}><button type="button" aria-label={`${step.number} ${step.label}: ${step.title} (${status})`} aria-current={activeRoute === step.id ? "step" : undefined} onClick={() => setRoute(step.id)}><span className="step-number">{step.number}</span><strong>{step.label}</strong><small>{step.title}</small><StatusPill tone={toneForStatus(status)}>{status}</StatusPill></button></li>; })}</ol>;
}

export function StepFrame({ builderPath, route, setRoute, children, helper }: { builderPath: BuilderPath; route: StepRoute; setRoute: (route: RouteId) => void; children: ReactNode; helper?: ReactNode }) {
  const journey = useJourney();
  const current = steps[builderPath].find((step) => step.id === route) ?? steps[builderPath][0];
  const index = steps[builderPath].findIndex((step) => step.id === route);
  const previous = steps[builderPath][index - 1];
  const next = steps[builderPath][index + 1];
  const progress = journey.progress.paths[builderPath][route];
  const required = getStepRequirements(builderPath, route);
  const verifiedCount = countVerifiedSteps(journey.progress, builderPath);
  const announcement = useRef<HTMLSpanElement>(null);
  const previousProgress = useRef({ status: progress.status, evidenceCount: progress.evidence.length });
  useEffect(() => {
    const previous = previousProgress.current;
    let message = "";
    if (previous.status !== progress.status || previous.evidenceCount !== progress.evidence.length) {
      if (progress.status === "verified") message = `${pathText[builderPath].label} ${current.label} verified. ${verifiedCount} of 4 journey steps verified.`;
      else if (progress.status === "skipped-with-reason") message = `${pathText[builderPath].label} ${current.label} deferred. The reason ${progress.blocker?.replaceAll("-", " ") ?? "user deferred"} was recorded.`;
      else if (progress.evidence.length > previous.evidenceCount) message = `Evidence recorded for ${pathText[builderPath].label} ${current.label}: ${progress.evidence.length} of ${required.length} required observations.`;
    }
    if (announcement.current) announcement.current.textContent = message;
    previousProgress.current = { status: progress.status, evidenceCount: progress.evidence.length };
  }, [builderPath, current.label, progress.blocker, progress.evidence.length, progress.status, required.length, verifiedCount]);
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
          <StatusPill tone={toneForStatus(progress.status)}>{progress.status}</StatusPill>
        </div>
        <ul className="evidence-list">
          {required.map((item) => (
            <li key={item} className={progress.evidence.includes(item) ? "observed" : "missing"}>
              {progress.evidence.includes(item) ? <CheckCircle2 size={15} /> : <span className="evidence-marker" aria-hidden="true" />}
              {evidenceLabels[item]}
            </li>
          ))}
        </ul>
        {progress.blocker ? <p className="blocker-note">Current blocker: {progress.blocker.replaceAll("-", " ")}.</p> : null}
        <span className="section-kicker">Done when</span>
        <ul>{current.done.map((item) => <li key={item}>{item}</li>)}</ul>
        {helper ? <div className="helper-slot">{helper}</div> : null}
        <button type="button" className="skip-button" onClick={() => journey.skip(builderPath, route, progress.blocker ?? "user-deferred")}>{progress.blocker ? "Continue with recorded blocker" : "Defer this step"}</button>
        <div className="step-actions">
          {previous ? <button type="button" onClick={() => setRoute(previous.id)}>Back: {previous.label}</button> : null}
          {next
            ? <button type="button" className="primary-button" onClick={() => setRoute(next.id)}>Next: {next.label}</button>
            : <button type="button" className="primary-button" onClick={() => setRoute("reference")}>Open reference</button>}
        </div>
      </aside>
    </section>
  );
}

export function CompanionActionButton({ companionStatus, setRoute, onAction, children, disabled = false }: { companionStatus: CompanionStatus; setRoute: (route: RouteId) => void; onAction: () => void | Promise<void>; children: ReactNode; disabled?: boolean }) {
  const { runtime: studioRuntime } = useStudioRuntime();
  if (!studioRuntime.companionAvailable) return <button className="primary-button" type="button" onClick={() => setRoute("companion")}>Available in local Studio</button>;
  if (companionStatus.state === "mismatch") return <button className="primary-button" type="button" onClick={() => setRoute("companion")}>Resolve local release mismatch</button>;
  if (companionStatus.state !== "available") return <button className="primary-button" type="button" onClick={() => setRoute("companion")} disabled={companionStatus.state === "checking"}>{companionStatus.state === "checking" ? "Checking companion" : "Set up local companion"}</button>;
  if (!companionStatus.capabilitiesEnabled) return <button className="primary-button" type="button" onClick={() => setRoute("companion")}>Enable local capabilities</button>;
  return <button className="primary-button" type="button" disabled={disabled} onClick={onAction}>{children}</button>;
}
