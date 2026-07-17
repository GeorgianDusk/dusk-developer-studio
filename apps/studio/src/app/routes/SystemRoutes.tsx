import { useEffect, useRef, useState } from "react";
import { safeJsonExport } from "@dusk/core/safe-export";
import { JOURNEY_PROGRESS_STORAGE_KEY, type BuilderPath } from "../journeyProgress";
import { expiryDate, sourceDate, sourceFreshness, sourceIsStale } from "../studioConfig";
import { useJourney, useStudioRuntime } from "../studioState";
import { AsyncNotice, ExternalLink, PageIntro, StatusPill } from "../StudioUi";
import type { CompanionStatus } from "../types";

export function LocalCompanionPage({ companionStatus, refreshCompanion }: { companionStatus: CompanionStatus; refreshCompanion: () => Promise<void> }) {
  const { runtime: studioRuntime, release } = useStudioRuntime();

  if (!studioRuntime.companionAvailable) {
    return (
      <section className="reference-page narrow">
        <PageIntro
          kicker="Automation"
          title="Use the hosted DuskDS guide manually today."
          copy="Hosted Studio provides reviewed instructions, commands, expected results, and manual confirmations. It cannot inspect your machine or create files. Portable automation is optional and is not publicly released yet."
        />
        <div className="focus-card wide">
          <StatusPill tone="good">Available now</StatusPill>
          <h2>Continue without installing Studio software</h2>
          <p>Choose DuskDS, follow each prerequisite and command on your own machine, then save only the results you actually observed. Manual confirmations stay visibly different from automated checks.</p>
          <ol>
            <li>Choose the DuskDS path.</li>
            <li>Open Setup and follow the manual prerequisites.</li>
            <li>Return to the same step after using any external documentation.</li>
          </ol>
          <div className="button-row"><a className="primary-button" href="#overview">Choose the DuskDS manual path</a></div>
        </div>
        <div className="focus-card wide secondary">
          <StatusPill tone="warn">Not published</StatusPill>
          <h2>Portable automation is being prepared</h2>
          <p>When a verified release is available, it will run allowlisted tool checks and create approved starter files through a loopback-only local session. The public website will never connect directly to your machine.</p>
          <p className="quiet-note">You do not need the source repository to use the manual guide. The source link below is provided only for advanced review and contribution.</p>
          <div className="button-row">
            <ExternalLink href="https://docs.dusk.network/developer/smart-contracts-duskds/">Open the DuskDS guide</ExternalLink>
            <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio">View source repository — advanced</ExternalLink>
          </div>
          <p className="quiet-note">External links open in a new tab; your Studio journey stays here.</p>
        </div>
      </section>
    );
  }

  const statusTone = companionStatus.state === "available" ? "good" : companionStatus.state === "mismatch" ? "danger" : companionStatus.state === "checking" ? "neutral" : "warn";
  const releaseCommit = release.commit.slice(0, 12);
  const companionRelease = "release" in companionStatus ? companionStatus.release : undefined;

  return (
    <section className="reference-page narrow">
      <PageIntro
        kicker="Automation"
        title="Portable Studio is paired to this release."
        copy="This local Studio pairs with its bundled runtime automatically. Machine actions stay off unless you deliberately start the Local Actions launcher."
      />
      <div className="focus-card wide">
        <h2>Portable session</h2>
        <StatusPill tone={statusTone}>{companionStatus.state === "available" ? companionStatus.capabilitiesEnabled ? "Actions ready" : "Safe mode" : companionStatus.state}</StatusPill>
        <p>{companionStatus.message}</p>
        <button className="secondary-button" type="button" onClick={refreshCompanion} disabled={companionStatus.state === "checking"}>Refresh status</button>
      </div>
      <div className="release-grid portable-release-grid">
        <div><span>Studio</span><strong>v{release.version}</strong><small>{releaseCommit} · portable</small></div>
        <div><span>Local automation</span><strong>{companionRelease ? `v${companionRelease.version}` : "Not verified"}</strong><small>{companionRelease ? `${companionRelease.commit.slice(0, 12)} · ${companionRelease.channel}` : "Waiting for an exact release match"}</small></div>
      </div>
      {companionStatus.state === "mismatch" ? (
        <AsyncNotice state="error" message="Do not use local actions. Close this tab and restart the matching Portable Studio release." />
      ) : companionStatus.state === "available" && companionStatus.capabilitiesEnabled ? (
        <div className="focus-card wide">
          <StatusPill tone="good">Local actions ready</StatusPill>
          <h2>Tool checks and starter creation are enabled</h2>
          <p>Actions are limited to the approved checks and projects folder for this run. Studio does not request wallet secrets or sign transactions.</p>
          <a className="primary-button" href="#overview">Choose or resume a path</a>
        </div>
      ) : (
        <div className="focus-card wide">
          <StatusPill tone="warn">Safe mode</StatusPill>
          <h2>Start Local Actions only when you need machine work</h2>
          <p>Safe mode can show instructions and read public Testnet data but cannot run tool checks or create starter files.</p>
          <ol>
            <li>Close this Portable Studio window.</li>
            <li>Run <strong>bin\dusk-studio-local-actions.cmd</strong> on Windows or <strong>bin/dusk-studio-local-actions</strong> on Linux or WSL.</li>
            <li>Return here and confirm the status reads “Actions ready” before creating files.</li>
          </ol>
          <p className="quiet-note">A normal restart keeps actions off. No token, Node installation, package-manager command, or source checkout is required.</p>
        </div>
      )}
    </section>
  );
}

export function SettingsPage({ builderPath, setBuilderPath }: { builderPath: BuilderPath | null; setBuilderPath: (path: BuilderPath | null) => void }) {
  const journey = useJourney();
  const { runtime: studioRuntime, release, companionBaseUrl } = useStudioRuntime();
  const releaseChannelLabel = release.channel === "portable"
    ? "Bundled local release"
    : release.channel === "source-dev"
      ? "Source development build"
      : "Public website";
  const [message, setMessage] = useState("No browser-data action yet.");
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
    sourceReceipt: {
      status: sourceFreshness.status,
      reviewedAt: sourceFreshness.reviewed_at,
      expiresAt: sourceFreshness.expires_at,
      recordCounts: sourceFreshness.provenance.record_counts
    },
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
    setMessage("Safe diagnostics downloaded.");
  }

  function clearData() {
    window.localStorage.removeItem("dusk-studio-builder-path");
    window.localStorage.removeItem(JOURNEY_PROGRESS_STORAGE_KEY);
    journey.reset();
    setBuilderPath(null);
    setConfirmingReset(false);
    setMessage("Selected path and step progress reset. Studio never stored wallet secrets, terminal output, or file contents.");
    window.requestAnimationFrame(() => resetButtonRef.current?.focus());
  }

  function beginReset() {
    setConfirmingReset(true);
    setMessage("Reset confirmation opened.");
  }

  function cancelReset() {
    setConfirmingReset(false);
    setMessage("Reset canceled. Browser progress was not changed.");
    window.requestAnimationFrame(() => resetButtonRef.current?.focus());
  }

  return (
    <section className="reference-page narrow">
      <PageIntro
        kicker="Build & browser data"
        title="See the build you are using and control its saved progress."
        copy="Studio keeps your selected path and step records in this browser. You can download safe diagnostics or clear that progress at any time."
      />
      {sourceIsStale ? <AsyncNotice state="stale" message="The reference review has expired. Check linked official sources because some details may have changed." /> : null}
      <div className="release-grid">
        <div><span>Studio version</span><strong>{`v${release.version}`}</strong><small>commit {release.commit.slice(0, 8)}</small></div>
        <div><span>Runtime</span><strong>{studioRuntime.companionAvailable ? "Portable Studio" : "Hosted manual guide"}</strong><small>{releaseChannelLabel}</small></div>
        <div><span>Sources reviewed</span><strong>{sourceDate}</strong><small>{sourceIsStale ? "Review expired" : "Review current"}</small></div>
        <div><span>Review valid through</span><strong>{expiryDate}</strong><small>Open the official source when accuracy is critical</small></div>
      </div>
      <div className="focus-card wide">
        <h2>Your browser data</h2>
        <ul>
          <li>Progress stays in this browser unless you download diagnostics.</li>
          <li>Studio stores step status, check labels, blockers, timestamps, and bounded result details you choose to record, such as a block height, hash, or artifact name.</li>
          <li>Studio does not store accounts, balances, wallet secrets, terminal output, file contents, or local paths.</li>
          <li>DuskEVM remains a pre-launch reference and does not produce a completion score.</li>
        </ul>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={exportDiagnostics}>Download safe diagnostics</button>
          {confirmingReset ? (
            <div className="reset-confirmation" role="group" aria-labelledby="reset-confirmation-title">
              <strong id="reset-confirmation-title">Reset all Studio progress in this browser?</strong>
              <span>This permanently clears the selected path, recorded checks, blockers, and step status.</span>
              <div className="button-row">
                <button ref={confirmResetButtonRef} className="danger-button" type="button" onClick={clearData}>Reset browser progress</button>
                <button className="secondary-button" type="button" onClick={cancelReset}>Cancel</button>
              </div>
            </div>
          ) : <button ref={resetButtonRef} className="secondary-button" type="button" onClick={beginReset}>Reset browser progress</button>}
          <ExternalLink href="https://github.com/GeorgianDusk/dusk-developer-studio/issues">Project support</ExternalLink>
          <ExternalLink href="https://docs.dusk.network/">Official Dusk docs</ExternalLink>
        </div>
        <p className="quiet-note" role="status" aria-live="polite" aria-atomic="true">{message}</p>
      </div>
    </section>
  );
}
