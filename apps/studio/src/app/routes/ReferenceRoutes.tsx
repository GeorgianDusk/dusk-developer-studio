import { useState } from "react";
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
} from "@dusk/core";
import { STEP_ROUTES, type BuilderPath } from "../journeyProgress";
import { capabilityIds, pathText, pickById, resourceIds, sourceDate, sourceIsStale, troubleIds } from "../studioConfig";
import { useJourney } from "../studioState";
import { AsyncNotice, ExternalLink, PageIntro, SearchBox, StatusPill } from "../StudioUi";

export function ReferencePage({ builderPath }: { builderPath: BuilderPath | null }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"path" | "all">(builderPath ? "path" : "all");
  const pathResourceIds = builderPath ? new Set(resourceIds[builderPath]) : null;
  const resources = query
    ? searchResources(query).filter((item) => scope === "all" || !pathResourceIds || pathResourceIds.has(item.id))
    : scope === "all" || !builderPath ? RESOURCES : pickById(RESOURCES, resourceIds[builderPath]);
  const capabilities = query
    ? searchCapabilities(query).filter((item) => scope === "all" || !builderPath || item.path === builderPath || item.path === "both")
    : scope === "all" || !builderPath ? CAPABILITIES : pickById(CAPABILITIES, capabilityIds[builderPath]);
  return <section className="reference-page"><PageIntro kicker="Reference" title="Deeper context, with source receipts." copy="Search all verified sources, or narrow to the journey you chose. Hedger remains reference-only; network actions remain Testnet-only." />{sourceIsStale ? <AsyncNotice state="stale" title="Source receipt expired" message="This build must not be promoted until the required Dusk sources are reviewed again." /> : null}<div className="filter-bar">{builderPath ? <button className={scope === "path" ? "active" : ""} type="button" onClick={() => setScope("path")}>{pathText[builderPath].label} only</button> : null}<button className={scope === "all" ? "active" : ""} type="button" onClick={() => setScope("all")}>All references</button><StatusPill tone={sourceIsStale ? "warn" : "good"}>sources checked {sourceDate}</StatusPill></div><SearchBox value={query} onChange={setQuery} placeholder="Search docs, capabilities, W3sper, Hedger, Citadel, data drivers..." />{resources.length === 0 && capabilities.length === 0 ? <AsyncNotice state="empty" message="No verified reference matches this search. Try a broader term or show all references." /> : <div className="reference-columns"><section><h2>Open docs</h2>{resources.length ? <div className="link-list">{resources.slice(0, query || scope === "all" ? 10 : 6).map((resource) => <ResourceRow key={resource.id} resource={resource} />)}</div> : <AsyncNotice state="empty" message="No documentation link matches this search." />}</section><section><h2>Capabilities</h2>{capabilities.length ? <div className="link-list">{capabilities.slice(0, query || scope === "all" ? 10 : 4).map((capability) => <CapabilityRow key={capability.id} capability={capability} />)}</div> : <AsyncNotice state="empty" message="No capability matches this search." />}</section></div>}<section className="network-reference"><h2>Network reference</h2><p>Mainnet and Devnet metadata are informational only; they expose no wallet, funding, RPC-check, or deployment action.</p><div className="network-reference-grid">{DUSK_EVM_NETWORKS.map((network) => <NetworkReferenceRow key={network.id} network={network} />)}</div></section></section>;
}

function ResourceRow({ resource }: { resource: Resource }) {
  const sourceHost = new URL(resource.url).hostname;
  return <a className="reference-row" href={resource.url} target="_blank" rel="noreferrer"><span>{resource.category}</span><strong>{resource.title}</strong><small>{resource.summary}</small><div className="provenance-line"><em>{resource.maturity}</em><em>{sourceHost}</em><em>checked {sourceDate}</em></div></a>;
}

function CapabilityRow({ capability }: { capability: Capability }) {
  return <div className="reference-row"><span>{capability.category}</span><strong>{capability.title}</strong><small>{capability.safeNextStep}</small><div className="provenance-line"><em>{capability.maturity}</em><em>{capability.sourceStatus}</em><em>checked {sourceDate}</em></div><div className="small-links">{capability.links.slice(0, 2).map((link) => <ExternalLink key={link.url} href={link.url}>{link.label}</ExternalLink>)}</div></div>;
}

function NetworkReferenceRow({ network }: { network: (typeof DUSK_EVM_NETWORKS)[number] }) {
  return <article className="reference-row network-row"><div className="button-row"><StatusPill tone={network.enabledByDefault ? "good" : "neutral"}>{network.enabledByDefault ? "interactive Testnet" : "read-only reference"}</StatusPill><span>{network.maturity}</span></div><strong>{network.name}</strong><small>Chain {network.chainId} / {network.chainIdHex}</small><small>{network.warning}</small><div className="provenance-line"><em>{network.sourceLabel}</em><em>checked {sourceDate}</em></div><ExternalLink href={network.sourceUrl}>Official network source</ExternalLink></article>;
}

export function TroubleshootingPage({ builderPath }: { builderPath: BuilderPath | null }) {
  const { progress } = useJourney();
  const [query, setQuery] = useState("");
  const currentBlocker = builderPath ? STEP_ROUTES.map((route) => progress.paths[builderPath][route]).find((step) => step.status === "blocked")?.blocker : undefined;
  const items = query ? searchTroubleshooting(query) : builderPath ? pickById(TROUBLESHOOTING, troubleIds[builderPath]) : TROUBLESHOOTING;
  return <section className="reference-page"><PageIntro kicker="Troubleshoot" title="Fix the blocker in front of you." copy="Selected-journey failures stay visible here. Search the symptom, apply the bounded fix, then repeat the evidence-producing check." />{currentBlocker ? <div className="current-blocker"><StatusPill tone="danger">current failure</StatusPill><strong>{currentBlocker.replaceAll("-", " ")}</strong><span>Return to the step after recovery and rerun its check.</span></div> : builderPath ? <div className="current-blocker"><StatusPill tone="good">no recorded blocker</StatusPill><span>Browse common recovery paths for {pathText[builderPath].label} below.</span></div> : <div className="current-blocker"><StatusPill tone="neutral">no path selected</StatusPill><span>Showing recovery paths for both DuskEVM and DuskDS.</span></div>}<SearchBox value={query} onChange={setQuery} placeholder="Search wrong chain, forge, wallet, WASM, data driver..." />{items.length ? <div className="trouble-list">{items.slice(0, query ? 10 : 6).map((item) => <TroubleRow key={item.id} item={item} />)}</div> : <AsyncNotice state="empty" message="No recovery entry matches this search. Try the recorded blocker wording or ask in official support." />}</section>;
}

function TroubleRow({ item }: { item: TroubleshootingItem }) {
  return <article className="trouble-row"><StatusPill tone={item.severity === "high" ? "danger" : item.severity === "medium" ? "warn" : "neutral"}>{item.severity}</StatusPill><div><h2>{item.title}</h2><p>{item.fix}</p><small>{item.safeNextStep}</small></div></article>;
}
