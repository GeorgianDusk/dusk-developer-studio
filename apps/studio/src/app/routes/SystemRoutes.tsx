import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { safeJsonExport } from "@dusk/core/safe-export";
import { JOURNEY_PROGRESS_STORAGE_KEY, type BuilderPath } from "../journeyProgress";
import { expiryDate, sourceDate, sourceIsStale } from "../studioConfig";
import { invalidatePriorBuilderPathHistory, useJourney, useStudioRuntime } from "../studioState";
import { createSafeDiagnostics } from "../safeDiagnostics";
import { AsyncNotice, CommandPair, CopyButton, ExternalLink, PageIntro, StatusPill } from "../StudioUi";
import type { CompanionStatus } from "../types";

export function LocalCompanionPage({ companionStatus, refreshCompanion }: { companionStatus: CompanionStatus; refreshCompanion: () => Promise<void> }) {
  const { runtime: studioRuntime, release } = useStudioRuntime();
  const packageSpecifier = `dusk-developer-studio@${release.version}`;
  const safeCommand = `npx ${packageSpecifier}`;
  const localActionsCommand = `${safeCommand} local-actions`;

  if (!studioRuntime.companionAvailable) {
    return (
      <section className="reference-page narrow">
        <PageIntro
          kicker="Local Studio"
          title="Run the full Studio locally with npm."
          copy="The hosted guide cannot inspect your machine or create files. The npm package opens the same Studio on your computer and pairs it with a loopback-only companion for DuskDS tool checks and DuskDS starter creation."
        />
        <AsyncNotice state="partial" title="DuskEVM remains reference-only" message="Running the npm package does not activate DuskEVM wallet, funding, signing, deployment, or starter actions. Local machine checks and starter creation are DuskDS-only." />
        <div className="focus-card wide">
          <StatusPill tone="good">Available through npm</StatusPill>
          <h2>Choose how much local access this session needs</h2>
          <p>Use Node.js 24.18 or newer in the Node 24 release line. Both commands download and execute the exact version shown. Safe mode starts only the Studio and pairing services; it does not run developer tools or create projects. Local Actions additionally enables the reviewed DuskDS tool checks and DuskDS starter scaffolds.</p>
          <CommandPair
            firstTitle="Safe mode"
            first={safeCommand}
            secondTitle="Local Actions"
            second={localActionsCommand}
          />
          <ol>
            <li>Run one command in your terminal. npm downloads the package and starts it in the foreground.</li>
            <li>Your browser opens <strong>127.0.0.1:5173</strong> and pairs automatically. Keep the terminal open while you use the local Studio.</li>
            <li>Press <strong>Ctrl+C</strong> in that terminal to stop both local services. On Windows, if npm asks <strong>Terminate batch job (Y/N)?</strong>, type <strong>Y</strong> and press Enter. Your projects remain in your user data folder.</li>
          </ol>
          <div className="button-row">
            <ExternalLink href="https://nodejs.org/en/download">Get Node.js</ExternalLink>
            <ExternalLink href={`https://www.npmjs.com/package/dusk-developer-studio/v/${release.version}`}>Review this package version and provenance</ExternalLink>
            <a className="secondary-button" href="#overview">Continue in the hosted guide</a>
          </div>
        </div>
        <div className="focus-card wide secondary">
          <StatusPill tone="neutral">Local boundary</StatusPill>
          <h2>What the npm package does</h2>
          <p>It serves the Studio only on <strong>127.0.0.1:5173</strong> and its companion only on <strong>127.0.0.1:8788</strong>. It installs no service, requests no administrator access, and never asks for wallet secrets.</p>
          <p>The first local page load uses one in-memory pairing value and a one-use bootstrap. The browser receives only an origin-bound, <strong>HttpOnly</strong>, <strong>SameSite=Strict</strong> session cookie. Other origins, hosts, unpaired requests, oversized requests, and expired sessions are rejected.</p>
          <p>Local Actions can run only the allowlisted DuskDS prerequisite checks and create approved DuskDS starter projects. DuskEVM actions, wallet signing, funded transactions, deployment, arbitrary commands, and writes outside the managed project root remain unavailable.</p>
          <details className="local-storage-disclosure">
            <summary>Where created projects are stored</summary>
            <ul>
              <li>Windows: <code>%LOCALAPPDATA%\Dusk\DeveloperStudio\projects</code></li>
              <li>macOS: <code>~/Library/Application Support/Dusk/DeveloperStudio/projects</code></li>
              <li>Linux: <code>{"${XDG_DATA_HOME:-~/.local/share}/dusk/developer-studio/projects"}</code></li>
            </ul>
          </details>
          <p className="quiet-note">The hosted website never connects to the local companion. Starting the npm package opens a separate local Studio session.</p>
        </div>
      </section>
    );
  }

  const statusTone = companionStatus.state === "available" ? "good" : companionStatus.state === "mismatch" ? "danger" : companionStatus.state === "checking" ? "neutral" : "warn";
  const releaseCommit = release.commit.slice(0, 12);
  const companionRelease = "release" in companionStatus ? companionStatus.release : undefined;
  const pageTitle = companionStatus.state === "available"
    ? "Local Studio is paired and ready."
    : companionStatus.state === "checking"
      ? "Local Studio is connecting."
      : companionStatus.state === "mismatch"
        ? "Local Studio release mismatch."
        : "Local Studio is not paired.";
  const pageCopy = companionStatus.state === "available"
    ? "This npm-launched Studio is paired with its local companion. Safe mode cannot perform machine actions; those are available only when you start the separately named Local Actions mode."
    : companionStatus.state === "checking"
      ? "Studio is checking the loopback companion and the browser session for this npm launch."
      : companionStatus.state === "mismatch"
        ? "The browser and local automation do not have the same release identity. Local actions stay blocked until you restart the matching package."
        : "This browser does not have the session for the current npm launch. No machine action is available until you pair the intended profile.";

  return (
    <section className="reference-page narrow">
      <PageIntro
        kicker="Local Studio"
        title={pageTitle}
        copy={pageCopy}
      />
      <div className="focus-card wide">
        <h2>Local session</h2>
        <StatusPill tone={statusTone}>{companionStatus.state === "available" ? companionStatus.capabilitiesEnabled ? "Actions ready" : "Safe mode" : companionStatus.state}</StatusPill>
        <p>{companionStatus.message}</p>
        <button className="secondary-button" type="button" onClick={refreshCompanion} disabled={companionStatus.state === "checking"}>Refresh status</button>
      </div>
      <div className="release-grid local-release-grid">
        <div><span>Studio</span><strong>v{release.version}</strong><small>{releaseCommit} · npm</small></div>
        <div><span>Local automation</span><strong>{companionRelease ? `v${companionRelease.version}` : "Not verified"}</strong><small>{companionRelease ? `${companionRelease.commit.slice(0, 12)} · ${companionRelease.channel}` : "Waiting for an exact release match"}</small></div>
      </div>
      {companionStatus.state === "mismatch" ? (
        <AsyncNotice state="error" message="Do not use local actions. Stop this session and start the matching npm package version." />
      ) : companionStatus.state === "available" && companionStatus.capabilitiesEnabled ? (
        <div className="focus-card wide">
          <StatusPill tone="good">Local actions ready</StatusPill>
          <h2>Tool checks and starter creation are enabled</h2>
          <p>Actions are limited to the approved checks and projects folder for this run. Studio does not request wallet secrets or sign transactions.</p>
          <a className="primary-button" href="#overview">Choose or resume a path</a>
        </div>
      ) : companionStatus.state === "available" ? (
        <div className="focus-card wide">
          <StatusPill tone="warn">Safe mode</StatusPill>
          <h2>Start Local Actions only when you need machine work</h2>
          <p>Safe mode can show instructions and read public Testnet data but cannot run tool checks or create starter files.</p>
          <ol>
            <li>Press <strong>Ctrl+C</strong> in the terminal that started this Studio. On Windows, confirm <strong>Y</strong> if npm asks to terminate the batch job.</li>
            <li>Start the same package in Local Actions mode:</li>
            <li>Use the Studio tab that opens and confirm the status reads “Actions ready” before creating files.</li>
          </ol>
          <div className="tool-command">
            <span>Local Actions</span>
            <pre>{localActionsCommand}</pre>
            <CopyButton value={localActionsCommand} label="Copy Local Actions command" />
          </div>
          <p className="quiet-note">Keep the terminal open while you work. Press <strong>Ctrl+C</strong> to stop the local Studio and companion; on Windows, confirm <strong>Y</strong> if npm asks to terminate the batch job.</p>
        </div>
      ) : companionStatus.state === "unavailable" ? (
        <div className="focus-card wide">
          <StatusPill tone="warn">Not paired</StatusPill>
          <h2>Pair the browser profile you intend to use</h2>
          <ol>
            <li>Close every Local Studio page and press <strong>Ctrl+C</strong> in the terminal that started this run. On Windows, confirm <strong>Y</strong> if npm asks to terminate the batch job.</li>
            <li>To use your default browser, rerun the normal Safe mode or Local Actions command and continue in the tab it opens.</li>
            <li>To choose a specific browser profile, rerun the matching command below and open <strong>http://127.0.0.1:5173/#companion</strong> in that profile within five minutes, before opening another Local Studio page.</li>
          </ol>
          <CommandPair
            firstTitle="Safe mode, choose browser"
            first={`${safeCommand} --no-open`}
            secondTitle="Local Actions, choose browser"
            second={`${localActionsCommand} --no-open`}
          />
        </div>
      ) : null}
    </section>
  );
}

export function SettingsPage({ builderPath, setBuilderPath }: { builderPath: BuilderPath | null; setBuilderPath: (path: BuilderPath | null) => void }) {
  const journey = useJourney();
  const { runtime: studioRuntime, release, companionBaseUrl } = useStudioRuntime();
  const releaseChannelLabel = release.channel === "npm"
    ? "npm package"
    : release.channel === "source-dev"
      ? "Source development build"
      : "Public website";
  const [message, setMessage] = useState("No browser-data action yet.");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const confirmResetButtonRef = useRef<HTMLButtonElement>(null);
  const restoreResetFocusRef = useRef(false);

  useEffect(() => {
    if (confirmingReset) confirmResetButtonRef.current?.focus();
  }, [confirmingReset]);

  useLayoutEffect(() => {
    if (!confirmingReset && restoreResetFocusRef.current) {
      restoreResetFocusRef.current = false;
      resetButtonRef.current?.focus();
    }
  }, [confirmingReset]);

  const diagnostics = createSafeDiagnostics({
    studioRuntime,
    release,
    builderPath,
    companionBaseUrl,
    journey: journey.progress
  });

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
    invalidatePriorBuilderPathHistory();
    setBuilderPath(null);
    restoreResetFocusRef.current = true;
    setConfirmingReset(false);
    setMessage("Selected path and saved DuskDS journey progress reset. Studio never stored wallet secrets, terminal output, or file contents.");
  }

  function beginReset() {
    setConfirmingReset(true);
    setMessage("Reset confirmation opened.");
  }

  function cancelReset() {
    restoreResetFocusRef.current = true;
    setConfirmingReset(false);
    setMessage("Reset canceled. Browser progress was not changed.");
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
        <div><span>Runtime</span><strong>{studioRuntime.companionAvailable ? "Local Studio" : "Hosted guide"}</strong><small>{releaseChannelLabel}</small></div>
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
            <div
              className="reset-confirmation"
              role="group"
              aria-labelledby="reset-confirmation-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelReset();
                }
              }}
            >
              <strong id="reset-confirmation-title">Reset saved DuskDS journey progress in this browser?</strong>
              <span>This permanently clears the selected path, recorded checks, blockers, timestamps, and step status. Session-only page choices end when you close this tab.</span>
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
