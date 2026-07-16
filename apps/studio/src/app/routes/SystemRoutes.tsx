import { useEffect, useRef, useState } from "react";
import { safeJsonExport } from "@dusk/core";
import { JOURNEY_PROGRESS_STORAGE_KEY, type BuilderPath } from "../journeyProgress";
import { expiryDate, sourceDate, sourceFreshness, sourceIsStale } from "../studioConfig";
import { useJourney, useStudioRuntime } from "../studioState";
import { AsyncNotice, ExternalLink, PageIntro, StatusPill } from "../StudioUi";
import type { CompanionStatus } from "../types";

export function LocalCompanionPage({ companionStatus, refreshCompanion }: { companionStatus: CompanionStatus; refreshCompanion: () => Promise<void> }) {
  const { runtime: studioRuntime, release } = useStudioRuntime();
  if (!studioRuntime.companionAvailable) {
    return <section className="reference-page narrow"><PageIntro kicker="Docs-only mode" title="Machine actions are unavailable in this build." copy="Hosted and source-development builds provide guidance, read-only public RPC checks, and references only. This independent project has not published a supported companion binary yet." /><div className="focus-card wide"><StatusPill tone="warn">Docs-only</StatusPill><h2>Review and run the public source safely</h2><p>The secure companion experience is reserved for a verified portable build. The public server never proxies or exposes the companion, and there is no manual token-copy workflow.</p><div className="button-row"><ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio">Project source</ExternalLink><ExternalLink href="https://docs.dusk.network/developer/overview/">Official Dusk docs</ExternalLink></div></div></section>;
  }
  const statusTone = companionStatus.state === "available" ? "good" : companionStatus.state === "mismatch" ? "danger" : companionStatus.state === "checking" ? "neutral" : "warn";
  const releaseCommit = release.commit.slice(0, 12);
  const companionRelease = "release" in companionStatus ? companionStatus.release : undefined;
  return <section className="reference-page narrow"><PageIntro kicker="Portable local Studio" title="Local runtime, bound to this exact release." copy="The portable launcher pairs this browser automatically. Machine actions stay off unless you deliberately start the Local Actions launcher." /><div className="focus-card wide"><span className="section-kicker">Runtime status</span><h2>Portable session</h2><StatusPill tone={statusTone}>{companionStatus.state === "available" ? companionStatus.capabilitiesEnabled ? "actions ready" : "safe mode" : companionStatus.state}</StatusPill><p>{companionStatus.message}</p><button className="secondary-button" type="button" onClick={refreshCompanion} disabled={companionStatus.state === "checking"}>Refresh status</button></div><div className="release-grid portable-release-grid"><div><span>Studio</span><strong>v{release.version}</strong><small>{releaseCommit} · portable</small></div><div><span>Local runtime</span><strong>{companionRelease ? `v${companionRelease.version}` : "Not verified"}</strong><small>{companionRelease ? `${companionRelease.commit.slice(0, 12)} · ${companionRelease.channel}` : "Waiting for an exact release receipt"}</small></div></div>{companionStatus.state === "mismatch" ? <AsyncNotice state="error" message="Do not use local actions. Close this tab and restart the matching portable bundle; never combine Studio files from different releases." /> : companionStatus.state === "available" && companionStatus.capabilitiesEnabled ? <div className="focus-card wide"><StatusPill tone="good">Local actions ready</StatusPill><h2>Tool checks and starter creation are enabled</h2><p>Actions remain allowlisted, loopback-only, and limited to the approved projects root for this run.</p></div> : <div className="focus-card wide"><StatusPill tone="warn">Safe mode</StatusPill><h2>Start Local Actions when you need machine work</h2><p>Safe mode can read documentation and public Testnet data but cannot run tool checks or create starter files.</p><ol><li>Close this portable Studio window.</li><li>Run <strong>bin\dusk-studio-local-actions.cmd</strong> on Windows or <strong>bin/dusk-studio-local-actions</strong> on Linux/WSL.</li><li>Return here and confirm the status reads “Actions ready” before creating files.</li></ol><p className="quiet-note">A normal restart keeps actions off. No token, Node installation, pnpm command, or source checkout is required.</p></div>}</section>;
}

export function SettingsPage({ builderPath, setBuilderPath }: { builderPath: BuilderPath | null; setBuilderPath: (path: BuilderPath | null) => void }) {
  const journey = useJourney();
  const { runtime: studioRuntime, release, companionBaseUrl } = useStudioRuntime();
  const [message, setMessage] = useState("No local browser action yet.");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const confirmResetButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingReset) confirmResetButtonRef.current?.focus();
  }, [confirmingReset]);
  const diagnostics = {
    mode: studioRuntime.mode,
    release,
    builderPath,
    sourceReceipt: { status: sourceFreshness.status, reviewedAt: sourceFreshness.reviewed_at, expiresAt: sourceFreshness.expires_at, recordCounts: sourceFreshness.provenance.record_counts },
    localAgentUrl: companionBaseUrl ?? "not-applicable-hosted",
    journey: journey.progress
  };
  function exportDiagnostics() {
    const blob = new Blob([safeJsonExport(diagnostics)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dusk-studio-diagnostics.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Diagnostics exported with redaction.");
  }
  function clearData() {
    window.localStorage.removeItem("dusk-studio-builder-path");
    window.localStorage.removeItem(JOURNEY_PROGRESS_STORAGE_KEY);
    journey.reset();
    setBuilderPath(null);
    setConfirmingReset(false);
    setMessage("Path choice and evidence-code progress reset. Wallet and file details were never stored.");
    window.requestAnimationFrame(() => resetButtonRef.current?.focus());
  }
  function beginReset() {
    setConfirmingReset(true);
    setMessage("Reset confirmation opened. Choose Reset all progress or Cancel.");
  }
  function cancelReset() {
    setConfirmingReset(false);
    setMessage("Reset canceled. Local progress was not changed.");
    window.requestAnimationFrame(() => resetButtonRef.current?.focus());
  }
  return <section className="reference-page narrow"><PageIntro kicker="Release & local data" title="Know exactly what this build knows." copy="The source receipt, runtime mode, release identity, and browser-local evidence state stay visible and resettable." />{sourceIsStale ? <AsyncNotice state="stale" message="The source receipt is expired. This release must not be promoted until its required sources are refreshed." /> : null}<div className="release-grid"><div><span>Release</span><strong>{`v${release.version} (${release.commit.slice(0, 8)})`}</strong><small>{studioRuntime.label} · {release.channel}</small></div><div><span>Source receipt</span><strong>{sourceFreshness.status}</strong><small>reviewed {sourceDate}</small></div><div><span>Receipt expiry</span><strong>{expiryDate}</strong><small>{sourceFreshness.policy} policy</small></div><div><span>Records</span><strong>{Object.values(sourceFreshness.provenance.record_counts).reduce((sum, count) => sum + count, 0)}</strong><small>capabilities, networks, resources, fixes</small></div></div><div className="focus-card wide"><h2>Public release gates</h2><ul><li>DuskEVM Mainnet and Devnet are reference-only.</li><li>Hedger remains educational and reference-only.</li><li>No bridge, faucet, deployment, or browser signing automation.</li><li>Local companion is loopback-only, paired, rate-limited, and capability-gated.</li><li>Progress stores evidence and blocker codes—not accounts, balances, identifiers, terminal output, or paths.</li></ul><div className="button-row"><button className="secondary-button" type="button" onClick={exportDiagnostics}>Export safe diagnostics</button>{confirmingReset ? <div className="reset-confirmation" role="group" aria-labelledby="reset-confirmation-title"><strong id="reset-confirmation-title">Reset both journeys?</strong><span>This permanently clears the selected path, recorded evidence codes, blockers, and step status in this browser.</span><div className="button-row"><button ref={confirmResetButtonRef} className="danger-button" type="button" onClick={clearData}>Reset all progress</button><button className="secondary-button" type="button" onClick={cancelReset}>Cancel</button></div></div> : <button ref={resetButtonRef} className="secondary-button" type="button" onClick={beginReset}>Reset local progress</button>}<ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio/issues">Project support</ExternalLink><ExternalLink href="https://docs.dusk.network/">Official Dusk docs</ExternalLink></div><p className="quiet-note" role="status" aria-live="polite" aria-atomic="true">{message}</p></div></section>;
}
