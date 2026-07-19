import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildDuskDsDeployCommandSet,
  type CommandPlatform
} from "@dusk/core/commands";
import { getDuskDsDeployReadiness } from "./deployReadiness";
import { PlatformPicker } from "./ManualJourneyUi";
import { initialCommandPlatform } from "./studioConfig";
import { useJourney } from "./studioState";
import { CommandPair, ExternalLink, StatusPill } from "./StudioUi";
import type { RouteId } from "./types";

export function DuskDsDeployReadiness({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const { progress } = useJourney();
  const [platform, setPlatform] = useState<CommandPlatform>(initialCommandPlatform);
  const readiness = getDuskDsDeployReadiness(progress);
  const commands = useMemo(() => buildDuskDsDeployCommandSet(platform), [platform]);

  function openCheck(checkId: string, route: RouteId) {
    setRoute(route);
    if (checkId !== "source") return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById("duskds-source-identity");
      target?.scrollIntoView({ block: "start" });
      target?.focus();
    });
  }

  return (
    <section
      className="focus-card wide deploy-readiness"
      id="duskds-deploy-readiness"
      aria-labelledby="duskds-deploy-readiness-title"
      tabIndex={-1}
    >
      <div className="deploy-readiness-heading">
        <div>
          <h2 id="duskds-deploy-readiness-title">3. Prepare a manual deployment</h2>
          <p>Use the evidence already recorded in Studio to find unfinished preparation. This gate never reads a wallet, checks funds, signs, or sends a transaction.</p>
        </div>
        <StatusPill tone={readiness.evidenceReady ? "good" : "warn"}>
          {readiness.evidenceReady
            ? "Pre-deploy evidence ready"
            : `${readiness.readyCount}/${readiness.requiredCount} evidence checks ready`}
        </StatusPill>
      </div>

      <ul className="deploy-readiness-list" aria-label="Manual deployment readiness">
        {readiness.checks.map((check) => (
          <li className={check.state} key={check.id}>
            <span className="deploy-readiness-icon" aria-hidden="true">
              {check.state === "ready"
                ? <CheckCircle2 size={18} />
                : check.state === "manual-check"
                  ? <ShieldCheck size={18} />
                  : <Circle size={18} />}
            </span>
            <span className="deploy-readiness-copy">
              <strong>{check.label}</strong>
              <small>
                {check.detail}
                {check.observedAt && check.expiresAt ? (
                  <span className="deploy-readiness-time">
                    Recorded <time dateTime={check.observedAt}>{new Date(check.observedAt).toLocaleString()}</time>
                    {" · "}refresh by <time dateTime={check.expiresAt}>{new Date(check.expiresAt).toLocaleString()}</time>
                  </span>
                ) : null}
              </small>
            </span>
            <StatusPill tone={check.state === "ready" ? "good" : check.state === "manual-check" ? "neutral" : "warn"}>
              {check.state === "ready" ? "Ready" : check.state === "manual-check" ? "Manual boundary" : "Needs evidence"}
            </StatusPill>
            {check.state === "needs-evidence" && check.route ? (
              <button className="secondary-button" type="button" onClick={() => openCheck(check.id, check.route!)}>
                {check.id === "source" ? "Record source identity" : `Open ${check.label}`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="deploy-boundary-note">
        <StatusPill tone="warn">Manual signing only</StatusPill>
        <p>{readiness.evidenceReady
          ? "The recorded non-secret evidence is complete. You still need to review the active DuskDS Testnet wallet settings, funding, unused deploy nonce, any contract-specific initialization arguments or gas overrides, and the final confirmation in your own terminal."
          : "Finish the missing evidence before treating the build as prepared. You can inspect the command shape now, but it is not a deployment approval."}</p>
      </div>

      <div className="deploy-command-section">
        <div>
          <h3>Review the installed wallet command</h3>
          <p>Rusk Wallet's local help is authoritative for the version on your machine. The template fixes the network to Testnet and keeps every account and transaction value as a placeholder.</p>
        </div>
        <PlatformPicker value={platform} onChange={setPlatform} />
        <CommandPair
          firstTitle="Check Rusk Wallet and local help"
          first={commands.prerequisiteChecks}
          secondTitle="Copy the manual deploy template"
          second={commands.deployTemplate}
        />
      </div>

      <div className="deploy-manual-checklist">
        <h3>Before you run the command</h3>
        <ol>
          <li>Confirm Rusk Wallet 0.3.0 or newer is using the intended DuskDS Testnet settings. Do not paste the settings output here because it includes your wallet directory.</li>
          <li>Confirm the deployer is funded and review the fee estimate outside Studio.</li>
          <li>Choose the public Testnet deployer address and an unused unsigned-decimal deploy nonce.</li>
          <li>If your contract needs initialization arguments or gas overrides, add them only after reviewing the installed wallet help. Initialization arguments must be even-length hex-encoded rkyv bytes without a <code>0x</code> prefix.</li>
          <li>Replace every placeholder, review the complete command, then run it in your trusted terminal.</li>
          <li>Keep the returned contract ID and transaction hash. Submission is not finality; confirm inclusion and finality separately before using the contract ID below.</li>
        </ol>
        <p className="quiet-note">Do not paste a password, mnemonic, seed, private key, wallet profile, or signing request into Studio. It neither needs nor accepts them.</p>
        <div className="button-row">
          <ExternalLink href="https://docs.dusk.network/developer/duskvm/quickstart/#5-deploy-on-testnet">Official DuskVM deployment guide</ExternalLink>
          <ExternalLink href="https://docs.dusk.network/learn/rusk-wallet/">Official Rusk Wallet guide</ExternalLink>
        </div>
      </div>
    </section>
  );
}
