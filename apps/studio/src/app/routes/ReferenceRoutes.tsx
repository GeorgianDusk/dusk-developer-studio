import { useEffect, useRef, useState } from "react";
import {
  CAPABILITIES,
  DUSK_EVM_NETWORKS,
  RESOURCES,
  TROUBLESHOOTING,
  searchCapabilities,
  searchResources,
  searchTroubleshooting,
  type Capability,
  type Resource,
  type TroubleshootingItem
} from "@dusk/core/browser-catalog";
import { STEP_ROUTES, type BuilderPath } from "../journeyProgress";
import { blockerLabels, pathText, pickById, prelaunchTroubleIds, resourceIds, sourceDate, sourceIsStale, steps, troubleIds } from "../studioConfig";
import { useJourney } from "../studioState";
import { AsyncNotice, CopyButton, ExternalLink, PageIntro, SearchBox, StatusPill } from "../StudioUi";

const DEFAULT_REFERENCE_LIMIT = 10;
const TROUBLESHOOTING_FOCUS_STORAGE_KEY = "dusk-studio-troubleshooting-focus";

const readerLabels: Record<string, string> = {
  archived: "Archived",
  "archived-source-context": "Archived background source",
  "external-official": "Official external resource",
  official: "Official documentation",
  "official-advanced": "Advanced official guidance",
  "official-docs-referenced": "Referenced by official documentation",
  "official-experimental": "Official experimental resource",
  "official-playbook": "Official implementation guide",
  "official-sdk": "Official SDK",
  "official-source": "Official source",
  "official-source-caveated": "Official source with caveats",
  "official-source-evolving": "Evolving official source",
  "official-docs": "Official documentation",
  "official-docs-source": "Official documentation and source",
  "advanced-official": "Advanced official guidance",
  "advanced-ready": "Advanced workflow",
  "advanced-source": "Advanced source",
  ecosystem: "Ecosystem resource",
  "experimental-review-required": "Experimental — review required",
  "manual-official": "Official manual workflow",
  "production-gate": "Production safeguard",
  "protocol-core": "Core protocol",
  "ready-local": "Usable locally",
  "ready-testnet": "Pre-launch Testnet reference",
  "source-context": "Background source context",
  "source-gap": "Implementation details incomplete",
  "unstable-examples": "Examples — not production ready",
  "unstable-source": "Unstable source — review before use",
  source: "Public source",
  "docs-mentioned": "Mentioned in documentation",
  "public-forks-caveated": "Public forks with caveats",
  testnet: "Pre-launch Testnet metadata",
  "mainnet-reference": "Mainnet reference metadata",
  "devnet-reference": "Devnet reference metadata"
};

function readerLabel(value: string): string {
  return readerLabels[value] ?? value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function prelaunchCapabilityNextStep(capability: Capability): string {
  if (capability.path !== "evm") return capability.safeNextStep;
  if (capability.id === "duskevm-confidential-hedger") {
    return "Track the linked Hedger sources as product direction. A guided implementation path needs more source-backed detail before activation.";
  }
  return "Use this as launch-planning context only. Live wallet, funding, starter, inspection, and deployment actions are not enabled in Studio.";
}

export function ReferencePage({ builderPath }: { builderPath: BuilderPath | null }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"path" | "all">(builderPath ? "path" : "all");
  const [showAllResources, setShowAllResources] = useState(false);
  const [showAllCapabilities, setShowAllCapabilities] = useState(false);
  const [resultAnnouncement, setResultAnnouncement] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim();
  const pathResourceIds = builderPath ? new Set(resourceIds[builderPath]) : null;

  const resources = normalizedQuery
    ? searchResources(normalizedQuery).filter((item) => scope === "all" || !pathResourceIds || pathResourceIds.has(item.id))
    : scope === "all" || !builderPath ? RESOURCES : pickById(RESOURCES, resourceIds[builderPath]);
  const capabilities = normalizedQuery
    ? searchCapabilities(normalizedQuery).filter((item) => scope === "all" || !builderPath || item.path === builderPath || item.path === "both")
    : scope === "all" || !builderPath
      ? CAPABILITIES
      : CAPABILITIES.filter((item) => item.path === builderPath || item.path === "both");
  const networksInScope = scope === "all" || !builderPath || builderPath === "evm" ? DUSK_EVM_NETWORKS : [];
  const networks = normalizedQuery
    ? networksInScope.filter((network) => [
        network.id,
        network.name,
        network.chainId,
        network.chainIdHex,
        network.warning,
        network.maturity
      ].join(" ").toLowerCase().includes(normalizedQuery.toLowerCase()))
    : networksInScope;
  const visibleResources = showAllResources ? resources : resources.slice(0, DEFAULT_REFERENCE_LIMIT);
  const visibleCapabilities = showAllCapabilities ? capabilities : capabilities.slice(0, DEFAULT_REFERENCE_LIMIT);
  const hasResults = resources.length > 0 || capabilities.length > 0 || networks.length > 0;

  useEffect(() => {
    if (!normalizedQuery) return;
    const timer = window.setTimeout(() => {
      setResultAnnouncement(
        `${resources.length} ${resources.length === 1 ? "document" : "documents"}, `
        + `${capabilities.length} ${capabilities.length === 1 ? "capability" : "capabilities"}, `
        + `and ${networks.length} ${networks.length === 1 ? "network record" : "network records"} found.`
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [capabilities.length, networks.length, normalizedQuery, resources.length]);

  function chooseScope(nextScope: "path" | "all") {
    setScope(nextScope);
    setShowAllResources(false);
    setShowAllCapabilities(false);
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setShowAllResources(false);
    setShowAllCapabilities(false);
    setResultAnnouncement("");
  }

  function searchAllReferences() {
    chooseScope("all");
    setResultAnnouncement("Search expanded to all reviewed references. Results updated.");
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function clearSearch() {
    searchInputRef.current?.focus();
    updateQuery("");
    setResultAnnouncement("Search cleared. References in the current scope restored.");
  }

  return (
    <section className="reference-page">
      <PageIntro
        kicker="Reference"
        title="Source-backed context for the task in front of you."
        copy="Search the sources reviewed for this Studio build, or narrow them to your selected path. External documentation opens in a new tab so your Studio session stays in place."
      />
      <p className="quiet-note">Rendered Dusk docs unavailable? <ExternalLink href="https://github.com/dusk-network/docs">Open the official docs source</ExternalLink>.</p>
      {sourceIsStale ? <AsyncNotice state="stale" title="Source review expired" message="Some details may be out of date. Check the linked official source before relying on them." /> : null}
      <div className="filter-bar" role="group" aria-label="Reference scope">
        {builderPath ? <button className={scope === "path" ? "active" : ""} type="button" aria-pressed={scope === "path"} onClick={() => chooseScope("path")}>{pathText[builderPath].label} only</button> : null}
        <button className={scope === "all" ? "active" : ""} type="button" aria-pressed={scope === "all"} onClick={() => chooseScope("all")}>All references</button>
        <StatusPill tone={sourceIsStale ? "warn" : "good"}>sources reviewed {sourceDate}</StatusPill>
      </div>
      <SearchBox inputRef={searchInputRef} value={query} onChange={updateQuery} placeholder="Search docs, capabilities, W3sper, Hedger, Citadel, data drivers..." />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{resultAnnouncement}</p>
      {!hasResults ? (
        <div className="empty-reference-actions">
          <AsyncNotice state="empty" message="No reviewed reference matches this search and scope. Try a broader term or search all references." />
          <div className="button-row">
            {normalizedQuery ? <button className="secondary-button" type="button" onClick={clearSearch}>Clear search</button> : null}
            {scope === "path" ? <button className="secondary-button" type="button" onClick={searchAllReferences}>Search all references</button> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="reference-columns">
            <section>
              <h2>Open docs <small>({resources.length})</small></h2>
              {resources.length ? (
                <>
                  {resources.length > DEFAULT_REFERENCE_LIMIT ? (
                    <button
                      className="secondary-button reference-disclosure-button"
                      type="button"
                      aria-expanded={showAllResources}
                      aria-controls="reference-docs-results"
                      onClick={() => setShowAllResources((current) => !current)}
                    >
                      {showAllResources ? "Show fewer docs" : `Show all ${resources.length} docs`}
                    </button>
                  ) : null}
                  <div className="link-list" id="reference-docs-results">{visibleResources.map((resource) => <ResourceRow key={resource.id} resource={resource} />)}</div>
                </>
              ) : <AsyncNotice state="empty" message="No documentation link matches this search and scope." />}
            </section>
            <section>
              <h2>Capabilities <small>({capabilities.length})</small></h2>
              {capabilities.length ? (
                <>
                  {capabilities.length > DEFAULT_REFERENCE_LIMIT ? (
                    <button
                      className="secondary-button reference-disclosure-button"
                      type="button"
                      aria-expanded={showAllCapabilities}
                      aria-controls="reference-capability-results"
                      onClick={() => setShowAllCapabilities((current) => !current)}
                    >
                      {showAllCapabilities ? "Show fewer capabilities" : `Show all ${capabilities.length} capabilities`}
                    </button>
                  ) : null}
                  <div className="link-list" id="reference-capability-results">{visibleCapabilities.map((capability) => <CapabilityRow key={capability.id} capability={capability} />)}</div>
                </>
              ) : <AsyncNotice state="empty" message="No capability matches this search and scope." />}
            </section>
          </div>
          {networks.length ? (
            <section className="network-reference">
              <h2>DuskEVM network metadata <small>({networks.length})</small></h2>
              <p>This is pre-launch reference material, not a signal that Studio wallet, funding, RPC, or deployment actions are active.</p>
              <div className="network-reference-grid">{networks.map((network) => <NetworkReferenceRow key={network.id} network={network} />)}</div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function ResourceRow({ resource }: { resource: Resource }) {
  const sourceHost = new URL(resource.url).hostname;
  const maturity = readerLabel(resource.maturity);
  return (
    <a
      className="reference-row"
      href={resource.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${resource.title}. ${maturity}. Opens ${sourceHost} in a new tab.`}
    >
      <span>{resource.category}</span>
      <strong>{resource.title}</strong>
      <small>{resource.summary}</small>
      <div className="provenance-line"><em>{maturity}</em><em>{sourceHost}</em><em>reviewed {sourceDate}</em></div>
    </a>
  );
}

function CapabilityRow({ capability }: { capability: Capability }) {
  return (
    <div className="reference-row">
      <span>{capability.category}</span>
      <strong>{capability.title}</strong>
      <small>{prelaunchCapabilityNextStep(capability)}</small>
      <div className="provenance-line"><em>{readerLabel(capability.maturity)}</em><em>{readerLabel(capability.sourceStatus)}</em><em>reviewed {sourceDate}</em></div>
      <div className="small-links">{capability.links.map((link) => <ExternalLink key={link.url} href={link.url}>{link.label}</ExternalLink>)}</div>
    </div>
  );
}

function NetworkReferenceRow({ network }: { network: (typeof DUSK_EVM_NETWORKS)[number] }) {
  const isTestnet = network.id === "dusk-evm-testnet";
  return (
    <article className="reference-row network-row">
      <div className="button-row"><StatusPill tone={isTestnet ? "warn" : "neutral"}>{isTestnet ? "pre-launch metadata" : "reference only"}</StatusPill><span>{readerLabel(network.maturity)}</span></div>
      <strong>{network.name}</strong>
      <small>Chain {network.chainId} / {network.chainIdHex}</small>
      <small>{network.warning}</small>
      <div className="provenance-line"><em>{network.sourceLabel}</em><em>reviewed {sourceDate}</em></div>
      <ExternalLink href={network.sourceUrl}>Official network source</ExternalLink>
    </article>
  );
}

export function TroubleshootingPage({
  builderPath,
  setBuilderPath,
  setRoute
}: {
  builderPath: BuilderPath | null;
  setBuilderPath: (path: BuilderPath | null) => void;
  setRoute: (route: "setup" | "build" | "troubleshooting") => void;
}) {
  const { progress } = useJourney();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"path" | "all">("path");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [focusedTroubleId, setFocusedTroubleId] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem(TROUBLESHOOTING_FOCUS_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const normalizedQuery = query.trim();
  const activeTroubleIds = new Set(troubleIds[builderPath ?? "duskds"]);
  const blockedRoute = builderPath
    ? STEP_ROUTES.find((route) => progress.paths[builderPath][route].status === "blocked")
    : undefined;
  const currentBlocker = builderPath && blockedRoute ? progress.paths[builderPath][blockedRoute].blocker : undefined;
  const candidates = normalizedQuery
    ? searchTroubleshooting(normalizedQuery)
    : focusedTroubleId
      ? TROUBLESHOOTING.filter((item) => item.id === focusedTroubleId)
      : TROUBLESHOOTING;
  const items = scope === "all" ? candidates : candidates.filter((item) => activeTroubleIds.has(item.id));
  const prelaunch = builderPath === "evm";
  const blockedStep = blockedRoute && builderPath
    ? steps[builderPath].find((step) => step.id === blockedRoute)
    : undefined;

  function clearSearch() {
    searchInputRef.current?.focus();
    setQuery("");
    setFocusedTroubleId(null);
  }

  function chooseTroubleshootingScope(nextScope: "path" | "all") {
    setScope(nextScope);
    setFocusedTroubleId(null);
  }

  useEffect(() => {
    if (!focusedTroubleId) return;
    const focusTimer = window.setTimeout(
      () => document.getElementById(`trouble-${focusedTroubleId}`)?.focus(),
      0
    );
    try {
      window.sessionStorage.removeItem(TROUBLESHOOTING_FOCUS_STORAGE_KEY);
    } catch {
      // The focused result is still rendered when session storage is disabled.
    }
    return () => window.clearTimeout(focusTimer);
  }, [focusedTroubleId]);

  return (
    <section className="reference-page">
      <PageIntro
        kicker="Troubleshoot"
        title={scope === "all" ? "Search every reviewed recovery and planning issue." : prelaunch ? "Review DuskEVM launch-planning issues." : "Fix the blocker in front of you."}
        copy={scope === "all"
          ? "Start with your selected path for the most relevant recovery. Use this complete index when the symptom crosses tools or you need a less common reviewed issue."
          : prelaunch
          ? "DuskEVM is still pre-launch. These entries explain issues to plan for later; they are not active wallet, funding, build, or deployment recovery steps."
          : "Find the symptom, understand the likely cause, apply the bounded fix, then repeat the check that produced the result."}
      />
      {prelaunch && scope === "path" ? <AsyncNotice state="partial" title="Pre-launch planning only" message="No DuskEVM troubleshooting item on this page represents a live Studio action." /> : null}
      {currentBlocker && blockedRoute ? (
        <div className="current-blocker">
          <StatusPill tone="danger">Current blocker</StatusPill>
          <strong>{blockedStep?.label ?? blockedRoute}: {blockerLabels[currentBlocker]}</strong>
          <a className="secondary-button" href={`#${blockedRoute}`}>Return to {blockedStep?.label ?? blockedRoute} and recheck</a>
        </div>
      ) : builderPath ? (
        <div className="current-blocker">
          <StatusPill tone={prelaunch ? "warn" : "good"}>{prelaunch ? "Pre-launch" : "No recorded blocker"}</StatusPill>
          <span>{prelaunch ? "Showing planning guidance for DuskEVM." : `Showing common recovery paths for ${pathText[builderPath].label}.`}</span>
        </div>
      ) : (
        <div className="current-blocker">
          <StatusPill tone="neutral">No path selected</StatusPill>
          <span>Showing active DuskDS recovery guidance. Choose a path for a more focused result.</span>
        </div>
      )}
      <div className="filter-bar" role="group" aria-label="Troubleshooting scope">
        <button className={scope === "path" ? "active" : ""} type="button" aria-pressed={scope === "path"} onClick={() => chooseTroubleshootingScope("path")}>
          {builderPath ? `${pathText[builderPath].label} common issues` : "DuskDS common issues"}
        </button>
        <button className={scope === "all" ? "active" : ""} type="button" aria-pressed={scope === "all"} onClick={() => chooseTroubleshootingScope("all")}>
          All reviewed issues
        </button>
      </div>
      <SearchBox
        inputRef={searchInputRef}
        value={query}
        onChange={(next) => {
          setQuery(next);
          if (next.trim()) setFocusedTroubleId(null);
        }}
        placeholder={scope === "all"
          ? "Search any reviewed symptom, tool, network, or failure..."
          : prelaunch
            ? "Search wallet, RPC, gas, Foundry..."
            : "Search Forge, Rust, WASM, data driver, VM tests..."}
      />
      <p className="quiet-note" role="status">{items.length} {scope === "all" ? "reviewed" : prelaunch ? "planning" : "recovery"} {items.length === 1 ? "entry" : "entries"} found.</p>
      {items.length ? <div className="trouble-list">{items.map((item) => (
        <TroubleRow
          key={item.id}
          item={item}
          prelaunch={prelaunchTroubleIds.includes(item.id as typeof prelaunchTroubleIds[number])}
          onOpenAction={(route) => {
            if (builderPath !== "duskds") setBuilderPath("duskds");
            setRoute(route);
          }}
        />
      ))}</div> : (
        <div className="empty-reference-actions">
          <AsyncNotice state="empty" message="No entry matches this search. Try the failed tool or symptom wording, or open project support." />
          <div className="button-row">
            {normalizedQuery ? <button className="secondary-button" type="button" onClick={clearSearch}>Clear search</button> : null}
            <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio/issues">Open project support</ExternalLink>
          </div>
        </div>
      )}
    </section>
  );
}

const duskDsTroubleActions: Partial<Record<string, { route: "setup" | "build"; label: string; command?: string }>> = {
  "duskds-existing-repository-read-only": { route: "build", label: "Return to Build" },
  "dusk-forge-windows-wasm-opt-shim": { route: "setup", label: "Open Setup" },
  "dusk-forge-windows-long-path-linker": { route: "build", label: "Open Build" },
  "rust-wasm-target-missing": { route: "setup", label: "Open Setup", command: "rustup toolchain install 1.94.0 --component rust-src --target wasm32-unknown-unknown" },
  "dusk-forge-rust-stable-drift": { route: "setup", label: "Open Setup", command: "rustup toolchain install 1.94.0 --component rust-src --target wasm32-unknown-unknown" },
  "data-driver-build-missing": { route: "build", label: "Open Build" },
  "dusk-forge-test-linux-required": { route: "setup", label: "Open Setup", command: "wsl --install -d Ubuntu-24.04" }
};

function TroubleRow({
  item,
  prelaunch,
  onOpenAction
}: {
  item: TroubleshootingItem;
  prelaunch: boolean;
  onOpenAction: (route: "setup" | "build") => void;
}) {
  const impact = item.severity === "high" ? "High impact" : item.severity === "medium" ? "Medium impact" : "Low impact";
  const action = prelaunch ? undefined : duskDsTroubleActions[item.id];
  return (
    <article className="trouble-row" id={`trouble-${item.id}`} tabIndex={-1}>
      <StatusPill tone={item.severity === "high" ? "danger" : item.severity === "medium" ? "warn" : "neutral"}>{prelaunch ? "Planning" : impact}</StatusPill>
      <div>
        <h2>{item.title}</h2>
        <strong>Cause and fix</strong>
        <p>{item.fix}</p>
        <div className="trouble-recheck">
          <strong>{prelaunch ? "Review before launch:" : "Recheck:"}</strong>
          <small>{item.safeNextStep}</small>
        </div>
        {action ? (
          <div className="button-row">
            {action.command ? <CopyButton value={action.command} label={`Copy fix command for ${item.title}`} /> : null}
            <button className="secondary-button" type="button" onClick={() => onOpenAction(action.route)}>{action.label}</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
