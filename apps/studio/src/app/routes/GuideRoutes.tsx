import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  quotePosixArg,
  quotePowerShellArg,
  resolveDuskDsProjectParent,
  resolveDuskDsProjectPath,
  WINDOWS_DUSKDS_MANAGED_ROOT_MAX_LENGTH,
  WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH,
  windowsPathToWsl,
  type CommandPlatform
} from "@dusk/core/commands";
import { classifyEvmIdentifier } from "@dusk/core/evm-read";
import {
  CompletionMethodPicker,
  ManualRecordNotice,
  ManualToolChecklist,
  PlatformPicker,
  type CompletionMethod
} from "../ManualJourneyUi";
import {
  DUSKDS_FORGE_COMMIT,
  DUSKDS_RUST_TOOLCHAIN,
  DUSKDS_TESTNET_NODE,
  DUSK_STUDIO_NODE_ENGINE,
  DUSK_STUDIO_NPM_PACKAGE_VERSION,
  W3SPER_INSTALL_COMMAND,
  W3SPER_CREATE_FILE_COMMAND,
  W3SPER_NODE_READ_SNIPPET,
  W3SPER_RUN_COMMAND,
  W3SPER_WORKSPACE_COMMAND,
  manualToolsFor,
  reviewedDuskForgeGuardCommands,
  reviewedDuskForgeInvocation,
  type ManualPlatform
} from "../manualJourneyConfig";
import {
  validateBlockObservation,
  validateBuildArtifacts,
  validateDriverObservation,
  validateRevision,
  type BlockObservationField,
  type BuildArtifactField,
  type DriverObservationKind,
  type DriverObservationField
} from "../manualEvidenceValidation";
import {
  DuskDsNodeReadError,
  readLatestDuskDsBlock,
  type DuskDsBlockObservation
} from "../duskDsNodeRead";
import { DuskDsDeployReadiness } from "../DuskDsDeployReadiness";
import { getDuskDsBuildSourceRevision } from "../deployReadiness";
import { isPreflightResult, isScaffoldEvidence, type PreflightResult } from "../responseSchemas";
import {
  LOCAL_ACTION_TIMEOUT_MS,
  requestJson,
  SafeRequestError,
  safeRequestMessage
} from "../safeRequest";
import { CompanionActionButton, StepFrame } from "../StudioShell";
import {
  AsyncNotice,
  CommandPair,
  CopyButton,
  ExternalLink,
  MiniSteps,
  PageIntro,
  StatusPill,
  type AsyncState
} from "../StudioUi";
import { defaultNetwork, initialManualPlatform } from "../studioConfig";
import { useJourney, useStudioRuntime } from "../studioState";
import type { CompanionStatus, RouteId } from "../types";
import { isJourneyComplete, type BuilderPath, type EvidenceEntry } from "../journeyProgress";

function stateForError(error: unknown): AsyncState {
  if (error instanceof SafeRequestError) {
    if (error.kind === "timeout") return "timeout";
    if (error.kind === "unavailable") return "unavailable";
  }
  if (error instanceof DuskDsNodeReadError) {
    if (error.kind === "timeout") return "timeout";
    if (error.kind === "unavailable") return "unavailable";
  }
  return "error";
}

function platformMetadata(platform: ManualPlatform): ManualPlatform {
  return platform;
}

function isManualPlatform(value: unknown): value is ManualPlatform {
  return value === "windows" || value === "linux" || value === "macos";
}

export function restoredManualAccessToolIds(
  evidence: EvidenceEntry | undefined,
  requiredToolIds: readonly string[]
): string[] {
  if (evidence?.method !== "manual" || requiredToolIds.length !== 1 || requiredToolIds[0] !== "deno") return [];
  const metadata = evidence.metadata;
  if (!metadata
    || !isManualPlatform(metadata.platform)
    || typeof metadata.blockHeight !== "number"
    || !Number.isSafeInteger(metadata.blockHeight)
    || metadata.blockHeight < 0
    || typeof metadata.blockHash !== "string"
    || !/^[a-f0-9]{64}$/i.test(metadata.blockHash)
  ) return [];
  const exactCurrentRecord = metadata.source === "manual-confirmation"
    && metadata.tool === "deno"
    && metadata.checkCount === 1;
  const boundedLegacyRecord = metadata.source === "manual-confirmation"
    && metadata.tool === undefined
    && metadata.checkCount === undefined;
  return exactCurrentRecord || boundedLegacyRecord ? ["deno"] : [];
}

function hasTruthfulDisposition(status: Parameters<typeof isJourneyComplete>[0]): boolean {
  return isJourneyComplete(status) || status === "skipped" || status === "skipped-with-reason";
}

type ResponseFileKey = "metadata" | "schema" | "encode" | "decode";

interface ResponseFetchSpec {
  key: ResponseFileKey;
  file: string;
  url: string;
  body?: string;
}

function buildPosixResponseTransaction(
  requests: ResponseFetchSpec[],
  platform: "linux" | "macos"
): string {
  const tempReferences = requests.map(({ key }) => `"$${key}Temp"`).join(" ");
  const lines = [
    "(",
    "set -e",
    ...requests.flatMap(({ key, file }) => [
      `${key}Final=${quotePosixArg(file)}`,
      `${key}Temp="$${key}Final.tmp.$$"`
    ]),
    `rm -f -- ${tempReferences}`,
    `trap 'rm -f -- ${tempReferences}' EXIT HUP INT TERM`,
    ...requests.flatMap(({ key, url, body }) => [
      `curl --fail-with-body --silent --show-error --request POST ${quotePosixArg(url)}${body === undefined ? "" : ` --data-raw ${quotePosixArg(body)}`} --output "$${key}Temp"`,
      `test -s "$${key}Temp"`
    ]),
    ...requests.map(({ key }) => `mv -f -- "$${key}Temp" "$${key}Final"`),
    "trap - EXIT HUP INT TERM",
    ...requests.map(({ key }) => `cat -- "$${key}Final"`),
    platform === "macos"
      ? `shasum -a 256 ${requests.map(({ key }) => `"$${key}Final"`).join(" ")}`
      : `sha256sum ${requests.map(({ key }) => `"$${key}Final"`).join(" ")}`,
    ")"
  ];
  return lines.join("\n");
}

function buildPowerShellResponseTransaction(requests: ResponseFetchSpec[]): string {
  const lines = [
    "& {",
    "  $ErrorActionPreference = 'Stop'",
    ...requests.flatMap(({ key, file }) => [
      `  $${key}Final = Join-Path (Get-Location) ${quotePowerShellArg(file)}`,
      `  $${key}Temp = "$${key}Final.tmp.$PID"`
    ]),
    ...requests.map(({ key }) => `  Remove-Item -LiteralPath $${key}Temp -Force -ErrorAction SilentlyContinue`),
    "  try {",
    ...requests.flatMap(({ key, url, body }) => [
      `    Invoke-WebRequest -UseBasicParsing -Method Post -Uri ${quotePowerShellArg(url)}${body === undefined ? "" : ` -Body ${quotePowerShellArg(body)}`} -OutFile $${key}Temp -ErrorAction Stop`,
      `    if (-not (Test-Path -LiteralPath $${key}Temp -PathType Leaf) -or (Get-Item -LiteralPath $${key}Temp -ErrorAction Stop).Length -eq 0) { throw '${key} response was empty.' }`
    ]),
    ...requests.map(({ key }) => `    Move-Item -LiteralPath $${key}Temp -Destination $${key}Final -Force -ErrorAction Stop`),
    ...requests.map(({ key }) => `    Get-Content -Raw -LiteralPath $${key}Final -ErrorAction Stop`),
    ...requests.map(({ key }) => `    (Get-FileHash -Algorithm SHA256 -LiteralPath $${key}Final -ErrorAction Stop).Hash`),
    "  } finally {",
    ...requests.map(({ key }) => `    Remove-Item -LiteralPath $${key}Temp -Force -ErrorAction SilentlyContinue`),
    "  }",
    "}"
  ];
  return lines.join("\r\n");
}

export function SetupPage({
  builderPath,
  companionStatus,
  setRoute
}: {
  builderPath: BuilderPath;
  companionStatus: CompanionStatus;
  setRoute: (route: RouteId) => void;
}) {
  return builderPath === "evm"
    ? <EvmPreviewPage />
    : <DuskDsSetup companionStatus={companionStatus} setRoute={setRoute} />;
}

export function AccessPage({
  builderPath,
  setRoute
}: {
  builderPath: BuilderPath;
  setRoute: (route: RouteId) => void;
}) {
  return builderPath === "evm" ? <EvmPreviewPage /> : <DuskDsAccess setRoute={setRoute} />;
}

export function BuildPage({
  builderPath,
  companionStatus,
  setRoute
}: {
  builderPath: BuilderPath;
  companionStatus: CompanionStatus;
  setRoute: (route: RouteId) => void;
}) {
  return builderPath === "evm"
    ? <EvmPreviewPage />
    : <DuskDsBuild companionStatus={companionStatus} setRoute={setRoute} />;
}

export function InspectPage({
  builderPath,
  setRoute
}: {
  builderPath: BuilderPath;
  setRoute: (route: RouteId) => void;
}) {
  return builderPath === "evm" ? <EvmPreviewPage /> : <DuskDsInspect setRoute={setRoute} />;
}

function EvmPreviewPage() {
  const [identifier, setIdentifier] = useState("");
  const classification = useMemo(() => classifyEvmIdentifier(identifier), [identifier]);
  const invalidIdentifier = identifier.trim().length > 0 && !classification;
  const plannedStages = [
    ["Setup", "Add the reviewed Testnet RPC and confirm the wallet is on the expected chain."],
    ["Access", "Read the selected account and DUSK gas balance without initiating a signature."],
    ["Build", "Compile and test a Solidity starter locally with Foundry or Hardhat."],
    ["Inspect", "Read blocks, transactions, contracts, and verified source through RPC and Blockscout."]
  ];
  return (
    <section className="reference-page evm-preview-page">
      <PageIntro
        kicker="DuskEVM pre-launch"
        title="Explore the planned DuskEVM developer workflow."
        copy="DuskEVM Testnet is not live yet. This is one learning and readiness surface—not a four-step task, completion score, network check, wallet flow, or deployment tool."
      />
      <div className="focus-card wide">
        <div className="button-row">
          <StatusPill tone="warn">Reference only</StatusPill>
          <span>No live evidence is recorded</span>
        </div>
        <h2>What you can use today</h2>
        <p>Review the planned execution model, Solidity toolchain, wallet and gas flow, explorer model, and activation boundary. Published network metadata is displayed for preparation only; the Studio does not treat it as live until DuskEVM Testnet is launched and revalidated.</p>
        <AsyncNotice state="partial" title="Linked guides are planning references" message="Some linked pages describe wallet, funding, signing, or deployment steps. Do not use those steps as proof that DuskEVM Testnet is live, and never pass a raw private key in a command. Wait for this Studio to show a revalidated live status and use a secure signer workflow." />
        <div className="button-row">
          <ExternalLink href="https://docs.dusk.network/developer/smart-contracts-dusk-evm/deploy-on-evm/">Deployment guide for planning</ExternalLink>
          <ExternalLink href="https://github.com/dusk-network/docs">Official docs source</ExternalLink>
          <ExternalLink href="https://docs.dusk.network/learn/deep-dive/dusk-evm/">DuskEVM deep dive</ExternalLink>
        </div>
        <div className="tool-command">
          <span>Pre-launch RPC reference</span>
          <pre>{defaultNetwork.rpcUrls[0]}</pre>
          <CopyButton value={defaultNetwork.rpcUrls[0]} label="Copy pre-launch RPC URL" />
        </div>
        <p className="quiet-note">Shown for inspection and configuration planning only. The Studio does not connect to this endpoint or treat it as live before activation checks pass.</p>
      </div>
      <div className="command-context">
        <StatusPill tone="warn">Not Studio-activated</StatusPill>
        <span>{defaultNetwork.name}</span>
        <span>Expected chain {defaultNetwork.chainId} / {defaultNetwork.chainIdHex}</span>
      </div>
      <div className="journey-preview evm-stage-preview">
        <div className="result-brief">
          <h2>Planned Setup → Access → Build → Inspect flow</h2>
          <p>These stages become actionable only after the Testnet endpoint, wallet behavior, starter, and inspection surfaces pass the reviewed activation gates.</p>
        </div>
        <ol>
          {plannedStages.map(([label, copy], index) => (
            <li key={label}><span>{index + 1}</span><strong>{label}</strong><small>{copy}</small></li>
          ))}
        </ol>
      </div>
      <div className="focus-card wide">
        <h2>Check an identifier’s shape locally</h2>
        <p>This browser-only helper recognizes the format of an EVM address, transaction hash, or block reference. It does not prove that the value exists, belongs to DuskEVM, or is safe.</p>
        <label>
          Example identifier
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="0x address, transaction hash, or block number"
            aria-invalid={invalidIdentifier || undefined}
            aria-describedby="evm-format-help evm-format-result"
          />
        </label>
        <p className="quiet-note" id="evm-format-help">Exact 40-digit addresses and 64-digit transaction hashes take priority. A canonical unsigned JSON-RPC quantity such as 0x1234, or an unsigned decimal block number such as 12345, is treated as a block reference and normalized to hexadecimal; a long value may still be a mistyped address or hash, so check its length.</p>
        <div className="button-row" id="evm-format-result" role="status" aria-live="polite">
          <StatusPill tone={classification ? "good" : invalidIdentifier ? "danger" : "neutral"}>
            {classification?.type ?? (invalidIdentifier ? "Unrecognized shape" : "Waiting for an example")}
          </StatusPill>
          {classification ? <span><strong>Normalized value:</strong> <code>{classification.value}</code></span> : null}
        </div>
      </div>
      <div className="focus-card secondary wide">
        <h2>Hedger is research context, not an active product claim</h2>
        <p>Hedger is relevant to the confidential-computing direction around DuskEVM, but this Studio does not present it as a live integration, investor promise, or current developer dependency.</p>
      </div>
    </section>
  );
}

function DuskDsSetup({
  companionStatus,
  setRoute
}: {
  companionStatus: CompanionStatus;
  setRoute: (route: RouteId) => void;
}) {
  const journey = useJourney();
  const { runtime, companionBaseUrl } = useStudioRuntime();
  const automaticAvailable = runtime.companionAvailable;
  const [method, setMethod] = useState<CompletionMethod>(automaticAvailable ? "automatic" : "manual");
  const [platform, setPlatform] = useState<ManualPlatform>(initialManualPlatform);
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [message, setMessage] = useState("Automatic preflight has not run.");
  const [state, setState] = useState<AsyncState>("idle");
  const manualHeadingRef = useRef<HTMLHeadingElement>(null);
  const requiredTools = manualToolsFor("setup").filter((tool) => tool.requirement === "required");
  const allRequiredConfirmed = requiredTools.every((tool) => confirmed.has(tool.id));
  const setupProgress = journey.progress.paths.duskds.setup;
  const manualSetupRecorded = setupProgress.evidenceEntries
    .some((entry) => entry.code === "duskds-required-preflight" && entry.method === "manual");

  function changeCompletionMethod(next: CompletionMethod) {
    if (next === method) return;
    if (setupProgress.evidence.length > 0 || setupProgress.blocker) {
      journey.invalidate("duskds", "setup");
    }
    setPreflight(null);
    setConfirmed(new Set());
    setState("idle");
    setMessage("Automatic preflight has not run.");
    setMethod(next);
  }

  function toggleTool(toolId: string) {
    if (confirmed.has(toolId) && manualSetupRecorded) {
      journey.removeEvidence("duskds", "setup", ["duskds-required-preflight"]);
    }
    setConfirmed((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }

  function continueManually() {
    changeCompletionMethod("manual");
    window.requestAnimationFrame(() => manualHeadingRef.current?.focus());
  }

  function changePlatform(next: ManualPlatform) {
    if (next === platform) return;
    if (manualSetupRecorded) journey.removeEvidence("duskds", "setup", ["duskds-required-preflight"]);
    setConfirmed(new Set());
    setPreflight(null);
    setState("idle");
    setMessage("Automatic preflight has not run.");
    setPlatform(next);
  }

  function recordManualSetup() {
    if (!allRequiredConfirmed) return;
    journey.record("duskds", "setup", ["duskds-required-preflight"], {
      method: "manual",
      metadata: {
        source: "manual-confirmation",
        tool: "dusk-forge",
        version: DUSKDS_RUST_TOOLCHAIN,
        revision: DUSKDS_FORGE_COMMIT,
        platform: platformMetadata(platform),
        checkCount: requiredTools.length
      }
    });
  }

  async function runPreflight() {
    setPreflight(null);
    setState("loading");
    setMessage("Running the bounded allowlisted preflight. The complete DuskDS check can take up to two minutes.");
    try {
      if (!companionBaseUrl) throw new Error("Local Studio is not connected.");
      const data = await requestJson(companionBaseUrl + "/preflight?path=duskds", {
        init: { credentials: "include" },
        validate: isPreflightResult,
        timeoutMs: LOCAL_ACTION_TIMEOUT_MS.preflight,
        maxBytes: 64 * 1024
      });
      setPreflight(data);
      const optionalFailures = data.tools.some((tool) => !tool.required && !tool.ok);
      setState(data.ok ? (optionalFailures ? "partial" : "success") : "error");
      setMessage(data.ok
        ? optionalFailures
          ? "Every required tool passed; optional tools still have suggested fixes."
          : "Every required native tool passed."
        : "At least one required tool needs a specific fix before Build.");
      if (data.ok) {
        journey.record("duskds", "setup", ["duskds-required-preflight"], {
          method: "automatic",
          observedAt: data.checkedAt,
          metadata: {
            source: "companion",
            tool: "dusk-forge",
            version: DUSKDS_RUST_TOOLCHAIN,
            revision: DUSKDS_FORGE_COMMIT,
            checkCount: data.tools.length
          }
        });
      } else {
        journey.block("duskds", "setup", "toolchain-incomplete");
      }
    } catch (error) {
      setState(stateForError(error));
      setMessage(error instanceof SafeRequestError && error.kind === "timeout"
        ? "The two-minute browser wait ended. The companion serializes machine actions, so another check cannot start while the first is still active. Wait briefly, then run the preflight once."
        : safeRequestMessage(error));
      if (error instanceof SafeRequestError && error.kind === "unavailable") {
        journey.block("duskds", "setup", "companion-unavailable");
      }
    }
  }

  return (
    <StepFrame
      builderPath="duskds"
      route="setup"
      setRoute={setRoute}
      helper={<ExternalLink href="https://github.com/dusk-network/forge">Dusk Forge source and releases</ExternalLink>}
    >
      <div className="focus-card wide">
        <h2>Choose how to check this machine</h2>
        <p>Use the complete manual Setup lane in the hosted guide, or run the Studio locally with npm to perform the same allowlisted checks automatically.</p>
        <CompletionMethodPicker
          value={method}
          onChange={changeCompletionMethod}
          automaticAvailable={automaticAvailable}
        />
      </div>
      {method === "manual" ? (
        <>
          <div className="focus-card wide">
            <h2 ref={manualHeadingRef} tabIndex={-1}>Run the required checks yourself</h2>
            <PlatformPicker value={platform} onChange={changePlatform} />
            <ManualToolChecklist scope="setup" platform={platform} confirmed={confirmed} onToggle={toggleTool} />
            {platform === "windows" ? (
              <div className="manual-record-notice">
                <StatusPill tone="neutral">conditional VM-test lane</StatusPill>
                <p>Setup also shows the Ubuntu 24.04 WSL check because Build's reviewed VM test runs there. WSL does not block the native Windows WASM build, but it is required before recording a Windows VM-test pass.</p>
              </div>
            ) : platform === "macos" ? (
              <div className="manual-record-notice">
                <StatusPill tone="warn">Linux VM test required</StatusPill>
                <p>The npm runtime and Local Actions lifecycle are supported on macOS. Native macOS DuskDS VM tests are not validated; Studio does not yet automate or review a Linux handoff.</p>
              </div>
            ) : null}
          </div>
          <div className="focus-card wide">
            <h2>Save the setup result</h2>
            <ManualRecordNotice>
              This records that you confirmed {requiredTools.length} required checks, Rust {DUSKDS_RUST_TOOLCHAIN}, and the reviewed Forge commit. It does not claim the browser inspected your machine.
            </ManualRecordNotice>
            <button className="primary-button" type="button" disabled={!allRequiredConfirmed} onClick={recordManualSetup}>
              Save manual setup confirmation
            </button>
            {!allRequiredConfirmed ? <p className="quiet-note">Mark every required tool checked before saving. Conditional and optional tools do not block Setup.</p> : null}
          </div>
        </>
      ) : automaticAvailable ? (
        <div className="focus-card wide">
          <h2>Run the allowlisted local preflight</h2>
          <p>The companion returns tool names, required status, bounded versions, and a specific failure category. It never returns environment variables, raw stack traces, secrets, or local paths.</p>
          <p className="quiet-note">On Windows, the optional Ubuntu 24.04 WSL row is the conditional VM-test lane. A failure there does not block the native WASM build, but it must be fixed before recording a Windows VM-test pass.</p>
          <CompanionActionButton
            companionStatus={companionStatus}
            setRoute={setRoute}
            onAction={runPreflight}
            disabled={state === "loading"}
          >
            Run automatic preflight
          </CompanionActionButton>
          {state === "idle"
            ? <p className="quiet-note">{message}</p>
            : <AsyncNotice
                state={state}
                message={message}
                onRetry={state === "error" || state === "timeout" || state === "unavailable" ? runPreflight : undefined}
              />}
          {preflight ? <PreflightPanel result={preflight} /> : null}
        </div>
      ) : (
        <div className="focus-card wide">
          <StatusPill tone="neutral">Run locally with npm</StatusPill>
          <h2>Start Local Studio for automatic checks</h2>
          <p>The hosted guide cannot inspect your machine. Start the npm package for allowlisted automatic checks, or complete every required check in the manual lane.</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={continueManually}>Continue manually</button>
            <button className="secondary-button" type="button" onClick={() => setRoute("companion")}>Get the npm command</button>
          </div>
        </div>
      )}
    </StepFrame>
  );
}

function PreflightPanel({ result }: { result: PreflightResult }) {
  return (
    <div className="tool-list" aria-label="Automatic preflight results">
      {result.tools.map((tool) => (
        <article key={tool.name} className={tool.ok ? "tool-row ok" : "tool-row fail"}>
          {tool.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
          <div>
            <div className="button-row">
              <strong>{tool.name}</strong>
              <StatusPill tone={tool.required ? "warn" : "neutral"}>{tool.required ? "required" : "optional"}</StatusPill>
            </div>
            {tool.ok ? (
              <p>{tool.version ?? "Check passed."}</p>
            ) : (
              <>
                <p><strong>Cause:</strong> {(tool.failureKind ?? "execution-failed").replaceAll("-", " ")}.</p>
                <p><strong>Fix:</strong> {tool.installHint ?? tool.error ?? "Review the tool installation, then run the preflight again."}</p>
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function DuskDsAccess({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const savedAccessEvidence = journey.progress.paths.duskds.access.evidenceEntries
    .find((entry) => entry.code === "duskds-node-read-attestation");
  const requiredAccessTools = manualToolsFor("access").filter((tool) => tool.requirement === "required");
  const restoredAccessToolIds = restoredManualAccessToolIds(
    savedAccessEvidence,
    requiredAccessTools.map((tool) => tool.id)
  );
  const savedManualPlatform = savedAccessEvidence?.method === "manual" && isManualPlatform(savedAccessEvidence.metadata?.platform)
    ? savedAccessEvidence.metadata.platform
    : initialManualPlatform;
  const restoredAccessObservation = savedAccessEvidence?.method === "automatic"
    && typeof savedAccessEvidence.metadata?.blockHeight === "number"
    && typeof savedAccessEvidence.metadata.blockHash === "string"
    ? {
        height: savedAccessEvidence.metadata.blockHeight,
        hash: savedAccessEvidence.metadata.blockHash,
        endpoint: savedAccessEvidence.metadata.endpoint ?? DUSKDS_TESTNET_NODE,
        observedAt: savedAccessEvidence.observedAt
      }
    : null;
  const [method, setMethod] = useState<CompletionMethod>(savedAccessEvidence?.method ?? "automatic");
  const [platform, setPlatform] = useState<ManualPlatform>(savedManualPlatform);
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set(restoredAccessToolIds));
  const [blockHeight, setBlockHeight] = useState(savedAccessEvidence?.method === "manual" ? savedAccessEvidence.metadata?.blockHeight?.toString() ?? "" : "");
  const [blockHash, setBlockHash] = useState(savedAccessEvidence?.method === "manual" ? savedAccessEvidence.metadata?.blockHash ?? "" : "");
  const [manualError, setManualError] = useState("");
  const [invalidManualField, setInvalidManualField] = useState<"height" | "hash" | null>(null);
  const manualHeightRef = useRef<HTMLInputElement>(null);
  const manualHashRef = useRef<HTMLInputElement>(null);
  const [automaticState, setAutomaticState] = useState<AsyncState>(restoredAccessObservation ? "success" : "idle");
  const [automaticMessage, setAutomaticMessage] = useState(
    restoredAccessObservation
      ? `Saved observation: block ${restoredAccessObservation.height} at ${new Date(restoredAccessObservation.observedAt).toLocaleString()}.`
      : "No hosted node check has run in this page visit."
  );
  const [observation, setObservation] = useState<DuskDsBlockObservation | null>(restoredAccessObservation);
  const toolsReady = requiredAccessTools.every((tool) => confirmed.has(tool.id));
  const setupStatus = journey.progress.paths.duskds.setup.status;
  const setupComplete = hasTruthfulDisposition(setupStatus);
  const manualAccessRecorded = journey.progress.paths.duskds.access.evidenceEntries
    .some((entry) => entry.code === "duskds-node-read-attestation" && entry.method === "manual");

  function toggleTool(toolId: string) {
    if (confirmed.has(toolId) && manualAccessRecorded) {
      journey.removeEvidence("duskds", "access", ["duskds-node-read-attestation"]);
    }
    setConfirmed((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }

  function changePlatform(next: ManualPlatform) {
    if (next === platform) return;
    if (manualAccessRecorded) journey.removeEvidence("duskds", "access", ["duskds-node-read-attestation"]);
    setConfirmed(new Set());
    setBlockHeight("");
    setBlockHash("");
    setManualError("");
    setInvalidManualField(null);
    setPlatform(next);
  }

  function changeManualBlockHeight(next: string) {
    if (next !== blockHeight && manualAccessRecorded) {
      journey.removeEvidence("duskds", "access", ["duskds-node-read-attestation"]);
    }
    setBlockHeight(next);
    setManualError("");
    setInvalidManualField(null);
  }

  function changeManualBlockHash(next: string) {
    if (next !== blockHash && manualAccessRecorded) {
      journey.removeEvidence("duskds", "access", ["duskds-node-read-attestation"]);
    }
    setBlockHash(next);
    setManualError("");
    setInvalidManualField(null);
  }

  async function runHostedRead() {
    if (automaticState === "loading") return;
    setAutomaticState("loading");
    setAutomaticMessage("Reading one latest-block header from the public DuskDS Testnet node.");
    setObservation(null);
    try {
      const result = await readLatestDuskDsBlock();
      setObservation(result);
      setAutomaticState("success");
      setAutomaticMessage(`Observed block ${result.height} with a bounded 32-byte hash.`);
      journey.record("duskds", "access", ["duskds-node-read-attestation"], {
        method: "automatic",
        observedAt: result.observedAt,
        metadata: {
          source: "browser-check",
          tool: "rpc",
          platform: "browser",
          blockHeight: result.height,
          blockHash: result.hash,
          endpoint: result.endpoint
        }
      });
    } catch (error) {
      setAutomaticState(stateForError(error));
      setAutomaticMessage(error instanceof Error ? error.message : "The public node read failed.");
      journey.block("duskds", "access", "duskds-public-node-unavailable");
    }
  }

  function recordManualRead() {
    const result = validateBlockObservation(blockHeight, blockHash);
    if (!result.value) {
      setManualError(result.error ?? "Enter the observed height and hash.");
      const invalidField = result.error?.includes("block height") ? "height" : "hash";
      setInvalidManualField(invalidField);
      window.requestAnimationFrame(() => {
        (invalidField === "height" ? manualHeightRef : manualHashRef).current?.focus();
      });
      return;
    }
    setManualError("");
    setInvalidManualField(null);
    journey.record("duskds", "access", ["duskds-node-read-attestation"], {
      method: "manual",
      metadata: {
        ...result.value,
        platform: platformMetadata(platform),
        tool: "deno",
        checkCount: requiredAccessTools.length
      }
    });
  }

  return (
    <StepFrame
      builderPath="duskds"
      route="access"
      setRoute={setRoute}
      helper={<ExternalLink href="https://docs.dusk.network/developer/integrations/w3sper/">Official W3sper documentation</ExternalLink>}
    >
      <div className="focus-card wide">
        <h2>Choose the read-only check</h2>
        <p>The hosted safe check reads one public block header directly. The manual lane teaches the W3sper application flow and stores only the values you enter.</p>
        {!setupComplete ? <AsyncNotice state="partial" title="Complete or skip Setup first" message="You can review this page now, but Access checks and evidence stay disabled until the earlier Setup step has a truthful disposition." /> : null}
        <CompletionMethodPicker
          value={method}
          onChange={setMethod}
          automaticAvailable
          automaticLabel="Hosted safe check"
          automaticDescription="One bounded, read-only public-node request from this browser. No companion or wallet is used."
          automaticAvailabilityLabel="available here"
        />
      </div>
      {method === "automatic" ? (
        <div className="focus-card wide">
          <h2>Read the public Testnet tip</h2>
          <p>This sends one bounded, read-only GraphQL request to {DUSKDS_TESTNET_NODE}. It uses no wallet, key, account, transaction, or companion.</p>
          <button
            className="primary-button"
            type="button"
            disabled={!setupComplete}
            aria-disabled={!setupComplete || automaticState === "loading"}
            onClick={runHostedRead}
          >
            {automaticState === "loading" ? "Reading latest block" : observation ? "Run safe check again" : "Run hosted safe check"}
          </button>
          {automaticState === "idle"
            ? <p className="quiet-note">{automaticMessage}</p>
            : <AsyncNotice
                state={automaticState}
                message={automaticMessage}
                onRetry={setupComplete && (automaticState === "error" || automaticState === "timeout" || automaticState === "unavailable") ? runHostedRead : undefined}
              />}
          {observation ? <BlockReceipt observation={observation} label="Automatic browser observation" /> : null}
        </div>
      ) : (
        <>
          <div className="focus-card wide">
            <h2>Run the W3sper query in a small Deno app</h2>
            <PlatformPicker value={platform} onChange={changePlatform} />
            <ManualToolChecklist scope="access" platform={platform} confirmed={confirmed} onToggle={toggleTool} />
            <MiniSteps items={[
              "Create a new dedicated working folder.",
              "Create check-duskds.ts and paste the reviewed script below.",
              "Add W3sper to that folder with Deno.",
              "Run the read-only script and record only the height and hash."
            ]} />
            <CommandPair
              firstTitle="Create dedicated working folder"
              first={W3SPER_WORKSPACE_COMMAND[platform]}
              secondTitle="Create check-duskds.ts"
              second={W3SPER_CREATE_FILE_COMMAND[platform]}
            />
            <h3>Paste this into check-duskds.ts</h3>
            <pre>{W3SPER_NODE_READ_SNIPPET}</pre>
            <CopyButton value={W3SPER_NODE_READ_SNIPPET} label="Copy the W3sper latest-block script" />
            <CommandPair
              firstTitle="Add W3sper"
              first={W3SPER_INSTALL_COMMAND[platform]}
              secondTitle="Run the read-only script"
              second={W3SPER_RUN_COMMAND[platform]}
            />
          </div>
          <div className="focus-card wide">
            <h2>Record exactly what you observed</h2>
            <ManualRecordNotice>
              Studio validates the height and 32-byte hash format. It cannot prove that your local script produced them.
            </ManualRecordNotice>
            <div className="evidence-form">
              <label>
                Block height
                <input
                  ref={manualHeightRef}
                  inputMode="numeric"
                  value={blockHeight}
                  aria-invalid={invalidManualField === "height" || undefined}
                  aria-describedby={invalidManualField === "height" ? "duskds-access-manual-error" : undefined}
                  onChange={(event) => changeManualBlockHeight(event.target.value)}
                  placeholder="3820996"
                />
              </label>
              <label>
                Block hash
                <input
                  ref={manualHashRef}
                  value={blockHash}
                  aria-invalid={invalidManualField === "hash" || undefined}
                  aria-describedby={invalidManualField === "hash" ? "duskds-access-manual-error" : undefined}
                  onChange={(event) => changeManualBlockHash(event.target.value)}
                  placeholder="64 hexadecimal characters"
                />
              </label>
            </div>
            {manualError ? <p className="validation-message" id="duskds-access-manual-error" role="alert">{manualError}</p> : null}
            <button className="primary-button" type="button" disabled={!setupComplete || !toolsReady} onClick={recordManualRead}>Save manual node observation</button>
            {!setupComplete
              ? <p className="quiet-note">Complete or skip Setup before saving Access evidence.</p>
              : !toolsReady
                ? <p className="quiet-note">Confirm the required Access tool before saving.</p>
                : null}
          </div>
        </>
      )}
    </StepFrame>
  );
}

function BlockReceipt({ observation, label }: { observation: DuskDsBlockObservation; label: string }) {
  return (
    <dl className="evidence-receipt">
      <div><dt>Method</dt><dd>{label}</dd></div>
      <div><dt>Height</dt><dd>{observation.height}</dd></div>
      <div><dt>Hash</dt><dd><code>{observation.hash}</code></dd></div>
      <div><dt>Observed</dt><dd>{new Date(observation.observedAt).toLocaleString()}</dd></div>
      <div><dt>Endpoint</dt><dd>{observation.endpoint}</dd></div>
    </dl>
  );
}

type ProjectMode = "new" | "existing";
const DUSKDS_BUILD_PROJECT_MODE_KEY = "dusk-studio-duskds-build-project-mode";

type ActiveScaffoldContext =
  | {
      schemaVersion: 1;
      status: "pending";
      requestId: number;
      projectName: string;
      parentDir?: string;
    }
  | {
      schemaVersion: 1;
      status: "complete";
      requestId: number;
      projectName: string;
      projectPath: string;
      platform: ManualPlatform;
      files: string[];
      rustToolchain: string;
      templateRevision: string;
      recovered: boolean;
    };

let activeScaffoldContext: ActiveScaffoldContext | null = null;
let scaffoldRequestSequence = 0;
const RUST_2024_RESERVED_PROJECT_NAMES = new Set([
  "abstract", "as", "async", "await", "become", "box", "break", "const", "continue", "crate",
  "do", "dyn", "else", "enum", "extern", "false", "final", "fn", "for", "gen", "if", "impl",
  "in", "let", "loop", "macro", "macro-rules", "match", "mod", "move", "mut", "override", "priv",
  "pub", "raw", "ref", "return", "safe", "self", "static", "struct", "super", "trait", "true",
  "try", "type", "typeof", "union", "unsafe", "unsized", "use", "virtual", "where", "while", "yield"
]);

function readActiveScaffoldContext(): ActiveScaffoldContext | null {
  return activeScaffoldContext;
}

function pathLooksAbsolute(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\");
}

function projectNameError(value: string): string {
  if (
    value !== value.trim()
    || value !== value.normalize("NFC")
    || !/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,79}$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  ) {
    return "Use 1–80 lowercase letters, numbers, or single hyphens. Start with a letter; do not end with or repeat a hyphen.";
  }
  if (RUST_2024_RESERVED_PROJECT_NAMES.has(value)) {
    return "Choose a different project name; Rust 2024 keywords and reserved words cannot be used.";
  }
  return "";
}

function pathFieldError(
  value: string,
  options: { label: string; platform: ManualPlatform; requireAbsolute?: boolean; managedSubfolder?: boolean; rejectFilesystemRoot?: boolean }
): string {
  if (value.length > 1_024) return `${options.label} must be 1,024 characters or fewer.`;
  if (/[\0\r\n]/.test(value)) return `${options.label} cannot contain NUL or line-break characters.`;
  const trimmed = value.trim();
  if (options.requireAbsolute && !trimmed) return `Enter an absolute ${options.label.toLowerCase()}.`;
  const platformAbsolute = options.platform === "windows"
    ? /^[a-zA-Z]:[\\/]/.test(trimmed)
    : trimmed.startsWith("/");
  if (options.requireAbsolute && !platformAbsolute) {
    return `${options.label} must be an absolute path.`;
  }
  if (
    (options.requireAbsolute || options.rejectFilesystemRoot)
    && (options.platform === "windows" ? /^[a-zA-Z]:[\\/]?$/.test(trimmed) : trimmed === "/")
  ) {
    return `${options.label} cannot be a filesystem root.`;
  }
  if (
    options.managedSubfolder
    && trimmed
    && (pathLooksAbsolute(trimmed) || trimmed.split(/[\\/]/).some((part) => part === ".."))
  ) {
    return `${options.label} must be a relative subfolder inside the managed DuskDS root.`;
  }
  return "";
}

function writeActiveScaffoldContext(value: ActiveScaffoldContext): void {
  activeScaffoldContext = value;
}

function clearActiveScaffoldContext(): void {
  activeScaffoldContext = null;
}

function activeScaffoldRequestMatches(requestId: number): boolean {
  return activeScaffoldContext?.status === "pending"
    && activeScaffoldContext.requestId === requestId;
}

function starterNodeRuntimeGuard(platform: ManualPlatform): string[] {
  const failure = `Node.js ${DUSK_STUDIO_NODE_ENGINE} is required before starter creation.`;
  if (platform === "windows") {
    return [
      '$studioNodeVersion = node -p "process.versions.node"',
      `if ($LASTEXITCODE -ne 0) { throw ${quotePowerShellArg(failure)} }`,
      "$studioNodeParts = @($studioNodeVersion.Split('.') | ForEach-Object { [int]$_ })",
      `if ($studioNodeParts.Count -lt 2 -or $studioNodeParts[0] -ne 24 -or $studioNodeParts[1] -lt 18) { throw ${quotePowerShellArg(failure)} }`,
      "npm.cmd --version",
      `if ($LASTEXITCODE -ne 0) { throw ${quotePowerShellArg("npm is required before starter creation.")} }`
    ];
  }
  const script = [
    'const [major, minor] = process.versions.node.split(".").map(Number);',
    `if (major !== 24 || minor < 18) { console.error(${JSON.stringify(failure)}); process.exit(1); }`,
    "console.log(process.version);"
  ].join(" ");
  return [
    `node -e ${quotePosixArg(script)}`,
    "npm --version"
  ];
}

function buildManualCommands({
  projectMode,
  projectName,
  parentDir,
  existingRoot,
  platform,
  createdProjectPath
}: {
  projectMode: ProjectMode;
  projectName: string;
  parentDir: string;
  existingRoot: string;
  platform: ManualPlatform;
  createdProjectPath?: string;
}): {
  projectPath: string;
  prepare: string;
  build: string;
  test: string;
  revision: string;
} {
  const name = projectName.trim();
  const commandPlatform: CommandPlatform = platform === "windows" ? "windows" : "posix";
  const checkedPowerShell = (command: string, message: string) =>
    `${command}; if ($LASTEXITCODE -ne 0) { throw '${message}' }`;
  const enterProject = (projectPath: string) => platform === "windows"
    ? `Set-Location -LiteralPath ${quotePowerShellArg(projectPath)} -ErrorAction Stop`
    : `cd ${quotePosixArg(projectPath)}`;
  const posixBlock = (...commands: string[]) => ["(", "set -e", ...commands, ")"].join("\n");
  const forgeGuard = reviewedDuskForgeGuardCommands(platform);
  const forge = (args: string) => reviewedDuskForgeInvocation(platform, args);
  const wslForgeGuard = reviewedDuskForgeGuardCommands("linux");
  const wslForge = (args: string) => reviewedDuskForgeInvocation("linux", args);
  if (projectMode === "new") {
    const createdParent = createdProjectPath
      ? resolveDuskDsProjectParent(createdProjectPath, name, commandPlatform)
      : undefined;
    const projectPath = resolveDuskDsProjectPath(
      createdParent ?? parentDir.trim(),
      name,
      commandPlatform
    );
    const root = resolveDuskDsProjectParent(projectPath, name, commandPlatform);
    const create = platform === "windows"
      ? `npx.cmd --yes dusk-developer-studio@${DUSK_STUDIO_NPM_PACKAGE_VERSION} create-duskds ${quotePowerShellArg(name)}`
      : `npx --yes dusk-developer-studio@${DUSK_STUDIO_NPM_PACKAGE_VERSION} create-duskds ${quotePosixArg(name)}`;
    const enter = enterProject(projectPath);
    const prepare = platform === "windows"
      ? [
          ...starterNodeRuntimeGuard(platform),
          `$parentPath = ${quotePowerShellArg(root)}`,
          "New-Item -ItemType Directory -Path $parentPath -Force -ErrorAction Stop | Out-Null",
          "Set-Location -LiteralPath $parentPath -ErrorAction Stop",
          checkedPowerShell(create, "Reviewed DuskDS template creation failed; no existing target was overwritten."),
          enter,
          checkedPowerShell(`rustup override set ${DUSKDS_RUST_TOOLCHAIN}`, "Rust override failed.")
        ].join("\n")
      : posixBlock(
          ...starterNodeRuntimeGuard(platform),
          `mkdir -p -- ${quotePosixArg(root)}`,
          `cd ${quotePosixArg(root)}`,
          create,
          enter,
          `rustup override set ${quotePosixArg(DUSKDS_RUST_TOOLCHAIN)}`
        );
    const build = platform === "windows"
      ? [
          ...forgeGuard,
          enter,
          checkedPowerShell(forge("check"), "Dusk Forge check failed."),
          checkedPowerShell(forge("build all"), "Dusk Forge build failed.")
        ].join("\n")
      : posixBlock(...forgeGuard, enter, forge("check"), forge("build all"));
    const test = platform === "windows"
      ? checkedPowerShell(
          `wsl -d Ubuntu-24.04 -- bash -lc ${quotePowerShellArg(
            `set -e; ${wslForgeGuard.join("; ")}; cd ${quotePosixArg(windowsPathToWsl(projectPath))}; rustup run ${quotePosixArg(DUSKDS_RUST_TOOLCHAIN)} ${wslForge("test")}`
          )}`,
          "Reviewed WSL VM test failed."
        )
      : platform === "linux"
        ? posixBlock(...forgeGuard, enter, `rustup run ${quotePosixArg(DUSKDS_RUST_TOOLCHAIN)} ${forge("test")}`)
        : "";
    const revision = platform === "windows"
      ? [
          enter,
          checkedPowerShell("git init", "git init failed."),
          checkedPowerShell("git add .", "git add failed."),
          checkedPowerShell("git write-tree", "git write-tree failed.")
        ].join("\n")
      : posixBlock(enter, "git init", "git add .", "git write-tree");
    return {
      projectPath,
      prepare,
      build,
      test,
      revision
    };
  }
  const root = existingRoot.trim();
  const enter = enterProject(root);
  let test: string;
  if (platform === "windows") {
    test = checkedPowerShell(
      `wsl -d Ubuntu-24.04 -- bash -lc ${quotePowerShellArg(
        `set -e; ${wslForgeGuard.join("; ")}; cd ${quotePosixArg(windowsPathToWsl(root))}; rustup run ${quotePosixArg(DUSKDS_RUST_TOOLCHAIN)} ${wslForge("test")}`
      )}`,
      "Reviewed WSL VM test failed."
    );
  } else if (platform === "linux") {
    test = posixBlock(...forgeGuard, enter, `rustup run ${quotePosixArg(DUSKDS_RUST_TOOLCHAIN)} ${forge("test")}`);
  } else {
    test = "";
  }
  const existingBaseline = platform === "windows"
    ? [
        enter,
        "$changes = @(git status --porcelain=v1 --untracked-files=all)",
        "if ($LASTEXITCODE -ne 0) { throw 'Git working-tree check failed.' }",
        "if ($changes.Count -ne 0) { throw 'Existing repository has tracked or untracked changes. Commit, stash, or remove them before recording evidence.' }",
        checkedPowerShell("git rev-parse --verify HEAD", "Git revision read failed.")
      ]
    : [
        enter,
        'changes="$(git status --porcelain=v1 --untracked-files=all)"',
        '[ -z "$changes" ] || { echo "Existing repository has tracked or untracked changes. Commit, stash, or remove them before recording evidence." >&2; exit 1; }',
        "git rev-parse --verify HEAD"
      ];
  return {
    projectPath: root,
    prepare: platform === "windows"
      ? [
          ...existingBaseline,
          ...forgeGuard,
          checkedPowerShell(`rustup override set ${DUSKDS_RUST_TOOLCHAIN}`, "Rust override failed."),
          checkedPowerShell(forge("check"), "Dusk Forge check failed.")
        ].join("\n")
      : posixBlock(...existingBaseline, ...forgeGuard, `rustup override set ${quotePosixArg(DUSKDS_RUST_TOOLCHAIN)}`, forge("check")),
    build: platform === "windows"
      ? [
          ...forgeGuard,
          enter,
          checkedPowerShell(forge("check"), "Dusk Forge check failed."),
          checkedPowerShell(forge("build all"), "Dusk Forge build failed.")
        ].join("\n")
      : posixBlock(...forgeGuard, enter, forge("check"), forge("build all")),
    test,
    revision: platform === "windows" ? existingBaseline.join("\n") : posixBlock(...existingBaseline)
  };
}

function DuskDsBuild({
  companionStatus,
  setRoute
}: {
  companionStatus: CompanionStatus;
  setRoute: (route: RouteId) => void;
}) {
  const journey = useJourney();
  const { runtime, companionBaseUrl } = useStudioRuntime();
  const automaticAvailable = runtime.companionAvailable;
  const storedScaffold = useMemo(() => readActiveScaffoldContext(), []);
  const restoredScaffold = storedScaffold?.status === "complete" ? storedScaffold : null;
  const interruptedScaffold = storedScaffold?.status === "pending" ? storedScaffold : null;
  const retainedAutomaticStructureEvidence = journey.progress.paths.duskds.build.evidenceEntries.some(
    (entry) => entry.code === "duskds-starter-structure" && entry.method === "automatic"
  );
  const mountedRef = useRef(true);
  const [method, setMethod] = useState<CompletionMethod>(
    automaticAvailable || storedScaffold ? "automatic" : "manual"
  );
  const [platform, setPlatform] = useState<ManualPlatform>(
    restoredScaffold?.platform ?? initialManualPlatform
  );
  const [projectMode, setProjectMode] = useState<ProjectMode>(() =>
    storedScaffold
      ? "new"
      : window.sessionStorage.getItem(DUSKDS_BUILD_PROJECT_MODE_KEY) === "existing" ? "existing" : "new"
  );
  const [projectName, setProjectName] = useState(storedScaffold?.projectName ?? "duskds-forge-starter");
  const [parentDir, setParentDir] = useState(interruptedScaffold?.parentDir ?? "");
  const [existingRoot, setExistingRoot] = useState("");
  const [existingRootTouched, setExistingRootTouched] = useState(false);
  const [structureRevision, setStructureRevision] = useState("");
  const [cargoConfirmed, setCargoConfirmed] = useState(false);
  const [toolchainConfirmed, setToolchainConfirmed] = useState(false);
  const [cleanTreeConfirmed, setCleanTreeConfirmed] = useState(false);
  const [postBuildSourceConfirmed, setPostBuildSourceConfirmed] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [structureErrorTarget, setStructureErrorTarget] = useState<"revision" | "checks" | "clean" | null>(null);
  const structureRevisionRef = useRef<HTMLInputElement>(null);
  const cargoConfirmationRef = useRef<HTMLButtonElement>(null);
  const toolchainConfirmationRef = useRef<HTMLButtonElement>(null);
  const cleanTreeConfirmationRef = useRef<HTMLButtonElement>(null);
  const postBuildSourceConfirmationRef = useRef<HTMLButtonElement>(null);
  const [files, setFiles] = useState<string[]>(restoredScaffold?.files ?? []);
  const [createdProjectPath, setCreatedProjectPath] = useState(restoredScaffold?.projectPath ?? "");
  const [scaffoldMessage, setScaffoldMessage] = useState(
    restoredScaffold
      ? `${restoredScaffold.recovered ? "Recovered" : "Restored"} verified DuskDS starter context for this tab.`
      : interruptedScaffold
        ? "The previous page session ended before the scaffold receipt arrived. Retry the same project to recover a strictly verified existing target without overwriting it."
        : retainedAutomaticStructureEvidence
          ? "The prior automatic evidence remains saved, but its private project path was intentionally not retained after refresh. Re-enter the same project name and subfolder to recover through the running companion, or choose Existing repository and attach the path manually."
        : "Automatic scaffold has not run."
  );
  const [scaffoldState, setScaffoldState] = useState<AsyncState>(
    restoredScaffold ? "success" : interruptedScaffold ? "error" : "idle"
  );
  const [scaffoldRecoverable, setScaffoldRecoverable] = useState(Boolean(interruptedScaffold));
  const [artifactInput, setArtifactInput] = useState({
    revision: "",
    contractName: "",
    contractSha256: "",
    contractSize: "",
    dataDriverName: "",
    dataDriverSha256: "",
    dataDriverSize: ""
  });
  const [artifactError, setArtifactError] = useState("");
  const [artifactInvalidField, setArtifactInvalidField] = useState<BuildArtifactField | null>(null);
  const artifactFieldRefs = useRef<Partial<Record<BuildArtifactField, HTMLInputElement | null>>>({});
  const [testsPassed, setTestsPassed] = useState(false);
  const [vmEnvironmentConfirmed, setVmEnvironmentConfirmed] = useState(false);
  const manualBuildHeadingRef = useRef<HTMLHeadingElement>(null);
  const projectInputError = projectMode === "new" ? projectNameError(projectName) : "";
  const baseCommandPathError = projectMode === "existing"
    ? pathFieldError(existingRoot, { label: "Existing project root", platform, requireAbsolute: true })
    : pathFieldError(parentDir, {
        label: method === "automatic" && automaticAvailable ? "Managed-root subfolder" : "Parent folder",
        platform,
        managedSubfolder: method === "automatic" && automaticAvailable,
        rejectFilesystemRoot: method === "manual"
      });
  const windowsCommandPathError = (() => {
    if (platform !== "windows" || projectInputError || baseCommandPathError) return "";
    if (projectMode === "existing") {
      return existingRoot.trim().length > WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH
        ? `Existing project root must be ${WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH} characters or fewer on Windows so Forge can build its generated files.`
        : "";
    }
    if (method === "automatic" && automaticAvailable && !createdProjectPath) return "";
    const projectPath = createdProjectPath || resolveDuskDsProjectPath(parentDir.trim(), projectName.trim(), "windows");
    const projectParent = resolveDuskDsProjectParent(projectPath, projectName.trim(), "windows");
    if (projectParent.length > WINDOWS_DUSKDS_MANAGED_ROOT_MAX_LENGTH) {
      return `Parent folder must be ${WINDOWS_DUSKDS_MANAGED_ROOT_MAX_LENGTH} characters or fewer on Windows so Forge can build its generated files.`;
    }
    return projectPath.length > WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH
      ? `DuskDS project path must be ${WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH} characters or fewer on Windows so Forge can build its generated files.`
      : "";
  })();
  const commandPathError = baseCommandPathError || windowsCommandPathError;
  const commandInputError = projectInputError || commandPathError;
  const projectInputErrorVisible = projectMode === "new" && Boolean(projectInputError);
  const commandPathErrorVisible = Boolean(commandPathError)
    && (projectMode !== "existing" || existingRootTouched);
  const commandContextPrompt = projectMode === "existing"
    ? "Enter a valid absolute existing project root above to generate these commands."
    : "Correct the project name or parent-folder value above to generate these commands.";
  const commands = useMemo(
    () => commandInputError ? null : buildManualCommands({
      projectMode,
      projectName,
      parentDir,
      existingRoot,
      platform,
      createdProjectPath: method === "automatic" ? createdProjectPath : undefined
    }),
    [commandInputError, createdProjectPath, existingRoot, method, parentDir, platform, projectMode, projectName]
  );
  const artifactCommands = useMemo(() => {
    if (!commands) return null;
    const expectedRevision = validateRevision(structureRevision).value;
    if (platform === "windows") {
      const enter = `Set-Location -LiteralPath ${quotePowerShellArg(commands.projectPath)} -ErrorAction Stop`;
      return {
        locate: [
          enter,
          "Get-ChildItem -File '.\\target\\contract\\wasm32-unknown-unknown\\release\\*.wasm' -ErrorAction Stop | Select-Object Name,Length",
          "Get-ChildItem -File '.\\target\\data-driver\\wasm32-unknown-unknown\\release\\*.wasm' -ErrorAction Stop | Select-Object Name,Length"
        ].join("\n"),
        hash: [
          enter,
          "Get-FileHash -Algorithm SHA256 '.\\target\\contract\\wasm32-unknown-unknown\\release\\*.wasm' -ErrorAction Stop",
          "Get-FileHash -Algorithm SHA256 '.\\target\\data-driver\\wasm32-unknown-unknown\\release\\*.wasm' -ErrorAction Stop"
        ].join("\n"),
        source: projectMode === "existing" && expectedRevision ? [
          enter,
          `$expectedRevision = '${expectedRevision}'`,
          "$changes = @(git status --porcelain=v1 --untracked-files=all)",
          "if ($LASTEXITCODE -ne 0) { throw 'Final Git working-tree check failed.' }",
          "if ($changes.Count -ne 0) { throw 'Source changed after the initial check. Commit, stash, or remove tracked and untracked changes, then rebuild, retest, and rehash.' }",
          "$currentRevision = (git rev-parse --verify HEAD).Trim().ToLowerInvariant()",
          "if ($LASTEXITCODE -ne 0) { throw 'Final Git revision read failed.' }",
          "if ($currentRevision -ne $expectedRevision) { throw 'HEAD changed after the initial check. Rebuild, retest, and rehash from the current commit.' }",
          "Write-Output \"FINAL_GIT_SOURCE_VERIFIED=$currentRevision\""
        ].join("\n") : ""
      };
    }
    const enter = `cd ${quotePosixArg(commands.projectPath)}`;
    const hashTool = platform === "macos" ? "shasum -a 256" : "sha256sum";
    return {
      locate: [
        "(",
        "set -e",
        enter,
        "contractFound=0",
        'for file in target/contract/wasm32-unknown-unknown/release/*.wasm; do if [ -f "$file" ]; then wc -c "$file"; contractFound=1; fi; done',
        '[ "$contractFound" -eq 1 ] || { echo "No contract WASM artifact found." >&2; exit 1; }',
        "driverFound=0",
        'for file in target/data-driver/wasm32-unknown-unknown/release/*.wasm; do if [ -f "$file" ]; then wc -c "$file"; driverFound=1; fi; done',
        '[ "$driverFound" -eq 1 ] || { echo "No data-driver WASM artifact found." >&2; exit 1; }',
        ")"
      ].join("\n"),
      hash: [
        "(",
        "set -e",
        enter,
        "contractFound=0",
        `for file in target/contract/wasm32-unknown-unknown/release/*.wasm; do if [ -f "$file" ]; then ${hashTool} "$file"; contractFound=1; fi; done`,
        '[ "$contractFound" -eq 1 ] || { echo "No contract WASM artifact found." >&2; exit 1; }',
        "driverFound=0",
        `for file in target/data-driver/wasm32-unknown-unknown/release/*.wasm; do if [ -f "$file" ]; then ${hashTool} "$file"; driverFound=1; fi; done`,
        '[ "$driverFound" -eq 1 ] || { echo "No data-driver WASM artifact found." >&2; exit 1; }',
        ")"
      ].join("\n"),
      source: projectMode === "existing" && expectedRevision ? [
        "(",
        "set -e",
        enter,
        `expectedRevision=${quotePosixArg(expectedRevision)}`,
        'changes="$(git status --porcelain=v1 --untracked-files=all)"',
        '[ -z "$changes" ] || { echo "Source changed after the initial check. Commit, stash, or remove tracked and untracked changes, then rebuild, retest, and rehash." >&2; exit 1; }',
        'currentRevision="$(git rev-parse --verify HEAD | tr "[:upper:]" "[:lower:]")"',
        '[ "$currentRevision" = "$expectedRevision" ] || { echo "HEAD changed after the initial check. Rebuild, retest, and rehash from the current commit." >&2; exit 1; }',
        'printf "FINAL_GIT_SOURCE_VERIFIED=%s\\n" "$currentRevision"',
        ")"
      ].join("\n") : ""
    };
  }, [commands, platform, projectMode, structureRevision]);
  const wasmOptTool = manualToolsFor("build").find((tool) => tool.id === "wasm-opt");
  const wslTool = manualToolsFor("build").find((tool) => tool.id === "wsl");
  const buildProgress = journey.progress.paths.duskds.build;
  const accessComplete = hasTruthfulDisposition(journey.progress.paths.duskds.access.status);
  const structureReady = buildProgress.evidence.includes("duskds-starter-structure");
  const savedArtifactRevision = buildProgress.evidenceEntries
    .find((entry) => entry.code === "duskds-build-artifact-attestation")
    ?.metadata?.revision ?? "";
  const hasRecordedBuildContext = buildProgress.evidence.length > 0
    || Boolean(buildProgress.blocker)
    || buildProgress.status === "skipped"
    || buildProgress.status === "skipped-with-reason";
  const scaffoldContextLocked = scaffoldState === "loading" || scaffoldRecoverable;

  useEffect(() => {
    mountedRef.current = true;
    const clearPrivateContext = () => clearActiveScaffoldContext();
    window.addEventListener("beforeunload", clearPrivateContext);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", clearPrivateContext);
    };
  }, []);

  useEffect(() => {
    if (restoredScaffold) {
      window.sessionStorage.setItem(DUSKDS_BUILD_PROJECT_MODE_KEY, "new");
    }
  }, [restoredScaffold]);

  function clearDependentBuildInputs() {
    setCargoConfirmed(false);
    setToolchainConfirmed(false);
    setCleanTreeConfirmed(false);
    setPostBuildSourceConfirmed(false);
    setStructureRevision("");
    setStructureError("");
    setStructureErrorTarget(null);
    setArtifactInput({
      revision: "",
      contractName: "",
      contractSha256: "",
      contractSize: "",
      dataDriverName: "",
      dataDriverSha256: "",
      dataDriverSize: ""
    });
    setArtifactError("");
    setArtifactInvalidField(null);
    setTestsPassed(false);
    setVmEnvironmentConfirmed(false);
    setFiles([]);
    setCreatedProjectPath("");
    setScaffoldState("idle");
    setScaffoldRecoverable(false);
    setScaffoldMessage("Automatic scaffold has not run.");
    clearActiveScaffoldContext();
  }

  function invalidateRecordedBuildContext() {
    if (hasRecordedBuildContext) journey.invalidate("duskds", "build");
  }

  function changeProjectMode(next: ProjectMode) {
    if (next === projectMode) return;
    invalidateRecordedBuildContext();
    clearDependentBuildInputs();
    setExistingRootTouched(next === "existing" && Boolean(existingRoot.trim()));
    window.sessionStorage.setItem(DUSKDS_BUILD_PROJECT_MODE_KEY, next);
    setProjectMode(next);
  }

  function changeCompletionMethod(next: CompletionMethod) {
    if (next === method) return;
    invalidateRecordedBuildContext();
    clearDependentBuildInputs();
    setMethod(next);
  }

  function continueBuildManually() {
    changeCompletionMethod("manual");
    window.requestAnimationFrame(() => manualBuildHeadingRef.current?.focus());
  }

  function setBuildPlatform(next: ManualPlatform) {
    if (next === platform) return;
    invalidateRecordedBuildContext();
    clearDependentBuildInputs();
    setPlatform(next);
  }

  function recordManualStructure() {
    if (!accessComplete) return;
    const revision = validateRevision(structureRevision);
    if (!revision.value) {
      setStructureError(revision.error ?? "Enter the source identity.");
      setStructureErrorTarget("revision");
      window.requestAnimationFrame(() => structureRevisionRef.current?.focus());
      return;
    }
    if (!cargoConfirmed || !toolchainConfirmed) {
      setStructureError("Confirm both Cargo.toml and rust-toolchain.toml before saving.");
      setStructureErrorTarget("checks");
      window.requestAnimationFrame(() => {
        (!cargoConfirmed ? cargoConfirmationRef.current : toolchainConfirmationRef.current)?.focus();
      });
      return;
    }
    if (projectMode === "existing" && !cleanTreeConfirmed) {
      setStructureError("Confirm that the existing repository had no tracked or untracked changes when its commit ID was read.");
      setStructureErrorTarget("clean");
      window.requestAnimationFrame(() => cleanTreeConfirmationRef.current?.focus());
      return;
    }
    setPostBuildSourceConfirmed(false);
    setStructureError("");
    setStructureErrorTarget(null);
    if (buildProgress.evidence.length > 0) journey.invalidate("duskds", "build");
    journey.record("duskds", "build", ["duskds-starter-structure"], {
      method: "manual",
      metadata: {
        source: "manual-confirmation",
        tool: "forge-starter",
        version: DUSKDS_RUST_TOOLCHAIN,
        revision: revision.value,
        platform: platformMetadata(platform),
        checkCount: projectMode === "existing" ? 3 : 2,
        ...(projectMode === "existing" ? {
          cleanTree: true,
          sourceScope: "git-commit-plus-unignored-working-tree"
        } : {})
      }
    });
    setArtifactInput((current) => ({ ...current, revision: current.revision || revision.value || "" }));
  }

  async function scaffoldForge() {
    if (!accessComplete) return;
    if (commandInputError) {
      setScaffoldState("error");
      setScaffoldMessage(commandInputError);
      return;
    }
    const requestedProjectName = projectName.trim();
    const requestedParent = parentDir.trim();
    const requestId = ++scaffoldRequestSequence;
    invalidateRecordedBuildContext();
    setFiles([]);
    setCreatedProjectPath("");
    setScaffoldState("loading");
    setScaffoldRecoverable(false);
    setScaffoldMessage("Creating the reviewed, packaged DuskDS template under the managed project root. No external generator runs during this action.");
    writeActiveScaffoldContext({
      schemaVersion: 1,
      status: "pending",
      requestId,
      projectName: requestedProjectName,
      ...(requestedParent ? { parentDir: requestedParent } : {})
    });
    try {
      if (!companionBaseUrl) throw new Error("Local Studio is not connected.");
      const data = await requestJson(companionBaseUrl + "/scaffold-duskds-forge", {
        init: {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectName: requestedProjectName, parentDir: requestedParent || undefined })
        },
        validate: isScaffoldEvidence,
        timeoutMs: LOCAL_ACTION_TIMEOUT_MS.scaffold,
        maxBytes: 64 * 1024
      });
      if (!activeScaffoldRequestMatches(requestId)) return;
      if (!data.ok || !data.structureVerified) throw new Error("The DuskDS starter structure could not be verified.");
      if (data.projectName !== requestedProjectName) {
        throw new Error("The scaffold receipt did not match the requested project.");
      }
      const receiptPlatform = data.runtimeOs;
      const rustToolchain = data.rustToolchain;
      const templateRevision = data.templateRevision;
      writeActiveScaffoldContext({
        schemaVersion: 1,
        status: "complete",
        requestId,
        projectName: data.projectName,
        projectPath: data.projectPath,
        platform: receiptPlatform,
        files: data.files,
        rustToolchain,
        templateRevision,
        recovered: Boolean(data.recovered)
      });
      if (mountedRef.current) {
        setPlatform(receiptPlatform);
        setFiles(data.files);
        setCreatedProjectPath(data.projectPath);
        setScaffoldState("success");
        setScaffoldRecoverable(false);
        setScaffoldMessage(data.recovered
          ? `Recovered the existing starter after strict content and Rust ${rustToolchain} verification; no files were written or overwritten.`
          : `Reviewed template ${data.template.slice(0, 64)} verified with Rust ${rustToolchain}, source ${templateRevision.slice(0, 12)}, and its packaged Cargo.lock.`
        );
      }
      journey.record("duskds", "build", ["duskds-starter-structure"], {
        method: "automatic",
        metadata: {
          source: "companion",
          tool: "studio-reviewed-template",
          version: rustToolchain,
          revision: templateRevision,
          platform: receiptPlatform,
          checkCount: data.files.length
        }
      });
    } catch (error) {
      if (!activeScaffoldRequestMatches(requestId)) return;
      const keepPending = error instanceof SafeRequestError
        && (error.kind === "timeout" || error.code === "capability_busy");
      if (!keepPending) clearActiveScaffoldContext();
      if (mountedRef.current) {
        setScaffoldState(stateForError(error));
        setScaffoldRecoverable(keepPending);
        setScaffoldMessage(error instanceof SafeRequestError && error.code === "scaffold_parent_outside_root"
          ? `${error.message} Enter only a relative subfolder, or leave it blank. No starter was created and no commands were generated for that path.`
          : error instanceof SafeRequestError && error.code === "scaffold_target_not_recoverable"
            ? `${error.message} Choose a new project name or inspect the existing folder yourself; Local Studio did not write or overwrite it.`
            : error instanceof SafeRequestError && error.kind === "timeout"
              ? "The browser wait ended. Retry the same project to recover a content-verified completed target; Local Studio will not write the reviewed template over an existing target."
              : safeRequestMessage(error));
      }
      if (mountedRef.current && error instanceof SafeRequestError && error.kind === "unavailable") {
        journey.block("duskds", "build", "companion-unavailable");
      }
    }
  }

  function recordArtifacts() {
    if (!accessComplete) return;
    const result = validateBuildArtifacts(artifactInput);
    if (!result.value) {
      setArtifactError(result.error ?? "Enter the bounded artifact details.");
      setArtifactInvalidField(result.field ?? null);
      window.requestAnimationFrame(() => {
        if (result.field) artifactFieldRefs.current[result.field]?.focus();
      });
      return;
    }
    const manualStructure = buildProgress.evidenceEntries.find((entry) => entry.code === "duskds-starter-structure" && entry.method === "manual");
    if (manualStructure?.metadata?.revision && result.value.revision !== manualStructure.metadata.revision) {
      setArtifactError("Use the same source identity saved in the manual structure confirmation.");
      setArtifactInvalidField("revision");
      window.requestAnimationFrame(() => artifactFieldRefs.current.revision?.focus());
      return;
    }
    if (projectMode === "existing" && !postBuildSourceConfirmed) {
      setArtifactError("Run and confirm the final Git source check after building, testing, and hashing the artifacts.");
      setArtifactInvalidField(null);
      window.requestAnimationFrame(() => postBuildSourceConfirmationRef.current?.focus());
      return;
    }
    setArtifactError("");
    setArtifactInvalidField(null);
    journey.record("duskds", "build", ["duskds-build-artifact-attestation"], {
      method: "manual",
      metadata: {
        ...result.value,
        platform: platformMetadata(platform),
        ...(projectMode === "existing" ? {
          postBuildSourceCheck: true,
          sourceScope: "git-commit-plus-unignored-working-tree"
        } : {})
      }
    });
  }

  function changeArtifactInput(next: typeof artifactInput) {
    const changedFields = (Object.keys(next) as Array<keyof typeof artifactInput>)
      .filter((field) => next[field] !== artifactInput[field]);
    if (changedFields.length > 0) {
      if (artifactInvalidField && changedFields.includes(artifactInvalidField)) {
        setArtifactError("");
        setArtifactInvalidField(null);
      }
      const revisionChanged = changedFields.includes("revision");
      const removals = [
        ...(buildProgress.evidence.includes("duskds-build-artifact-attestation")
          ? ["duskds-build-artifact-attestation" as const]
          : []),
        ...(revisionChanged && buildProgress.evidence.includes("duskds-vm-test-attestation")
          ? ["duskds-vm-test-attestation" as const]
          : [])
      ];
      if (removals.length > 0) journey.removeEvidence("duskds", "build", removals);
      if (revisionChanged) setTestsPassed(false);
      if (revisionChanged) setPostBuildSourceConfirmed(false);
    }
    setArtifactInput(next);
  }

  function recordTests() {
    if (!accessComplete) return;
    const revision = validateRevision(artifactInput.revision || structureRevision);
    if (
      platform === "macos"
      || !testsPassed
      || !revision.value
      || !savedArtifactRevision
      || revision.value !== savedArtifactRevision
      || (platform === "windows" && !vmEnvironmentConfirmed)
    ) return;
    journey.record("duskds", "build", ["duskds-vm-test-attestation"], {
      method: "manual",
      metadata: {
        source: "manual-confirmation",
        tool: "dusk-forge",
        version: DUSKDS_RUST_TOOLCHAIN,
        revision: revision.value,
        testEnvironment: platform === "windows" ? "wsl-ubuntu-24.04" : "linux",
        testsPassed: true,
        platform: platform === "windows" ? "wsl" : "linux"
      }
    });
  }

  return (
    <StepFrame
      builderPath="duskds"
      route="build"
      setRoute={setRoute}
      helper={<ExternalLink href="https://github.com/dusk-network/forge">Dusk Forge source</ExternalLink>}
    >
      <div className="focus-card wide">
        <h2>Choose your project and completion method</h2>
        {!accessComplete ? <AsyncNotice state="partial" title="Complete or skip Access first" message="You can review the Build commands now, but project creation and Build evidence stay disabled until Access has a truthful disposition." /> : null}
        <div className="method-picker compact" role="group" aria-label="Choose project type">
          <button disabled={scaffoldContextLocked} className={projectMode === "new" ? "method-option active" : "method-option"} type="button" aria-pressed={projectMode === "new"} onClick={() => changeProjectMode("new")}>
            <span><strong>New Forge starter</strong><small>Create the reviewed Counter template.</small></span>
          </button>
          <button disabled={scaffoldContextLocked} className={projectMode === "existing" ? "method-option active" : "method-option"} type="button" aria-pressed={projectMode === "existing"} onClick={() => changeProjectMode("existing")}>
            <span><strong>Existing repository</strong><small>Check and build your current Forge project.</small></span>
          </button>
        </div>
        <CompletionMethodPicker value={method} onChange={changeCompletionMethod} automaticAvailable={automaticAvailable} disabled={scaffoldContextLocked} />
      </div>
      <div className="focus-card wide">
        <h2>Set the command context</h2>
        <PlatformPicker value={platform} onChange={setBuildPlatform} disabled={scaffoldContextLocked} />
        <div className="form-grid">
          {projectMode === "new" ? (
            <>
              <label>Project name<input
                disabled={scaffoldContextLocked}
                value={projectName}
                aria-invalid={projectInputErrorVisible}
                aria-describedby={projectInputErrorVisible ? "duskds-build-project-name-error" : undefined}
                onChange={(event) => {
                if (event.target.value !== projectName) {
                  invalidateRecordedBuildContext();
                  clearDependentBuildInputs();
                  setProjectName(event.target.value);
                }
              }} /></label>
              <label>{method === "automatic" && automaticAvailable ? "Subfolder inside managed DuskDS root, optional" : "Parent folder, optional"}<input
                disabled={scaffoldContextLocked}
                value={parentDir}
                aria-invalid={commandPathErrorVisible}
                aria-describedby={commandPathErrorVisible ? "duskds-build-parent-dir-error" : undefined}
                onChange={(event) => {
                if (event.target.value !== parentDir) {
                  invalidateRecordedBuildContext();
                  clearDependentBuildInputs();
                  setParentDir(event.target.value);
                }
              }} placeholder={method === "automatic" && automaticAvailable ? "examples" : platform === "windows" ? "C:\\tmp\\dusk-studio-projects" : ".generated"} /></label>
            </>
          ) : (
            <label>Existing project root<input
              disabled={scaffoldContextLocked}
              value={existingRoot}
              aria-invalid={commandPathErrorVisible}
              aria-describedby={commandPathErrorVisible ? "existing-project-root-error" : undefined}
              onBlur={() => setExistingRootTouched(true)}
              onChange={(event) => {
              setExistingRootTouched(true);
              if (event.target.value !== existingRoot) {
                invalidateRecordedBuildContext();
                clearDependentBuildInputs();
                setExistingRoot(event.target.value);
              }
            }} placeholder={platform === "windows" ? "C:\\absolute\\path\\to\\project" : "/absolute/path/to/project"} /></label>
          )}
        </div>
        {projectInputErrorVisible ? <p id="duskds-build-project-name-error" className="validation-message" role="alert">{projectInputError}</p> : null}
        {commandPathErrorVisible ? <p id={projectMode === "existing" ? "existing-project-root-error" : "duskds-build-parent-dir-error"} className="validation-message" role="alert">{commandPathError}</p> : null}
        {platform === "windows" ? <p className="quiet-note">Keep the parent folder at {WINDOWS_DUSKDS_MANAGED_ROOT_MAX_LENGTH} characters or fewer and the complete project path at {WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH} characters or fewer so Forge's generated native-linker paths remain buildable.</p> : null}
        <p className="quiet-note">Paths stay only in this tab's active memory and are never written to browser storage, journey evidence, or diagnostics.</p>
      </div>
      {method === "automatic" ? (
        projectMode === "existing" ? (
          <div className="focus-card wide">
            <StatusPill tone="warn">Existing repository boundary</StatusPill>
            <h2>Local Actions does not attach to existing repositories</h2>
            <p>Local Actions checks prerequisites and creates new reviewed starters only. It does not attach to, import, crawl, or write to an existing repository.</p>
            <p>Use the manual existing-repository checks below for your current project. You can also open Local Studio setup to review its modes and security boundary.</p>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={continueBuildManually}>Continue with manual existing-repo checks</button>
              <button className="secondary-button" type="button" onClick={() => setRoute("companion")}>Open Local Studio setup</button>
            </div>
          </div>
        ) : automaticAvailable ? (
          <div className="focus-card wide">
            <h2>Create and inspect the starter locally</h2>
            <p>The paired companion creates only inside its managed DuskDS root from the reviewed template and Cargo.lock shipped in this exact npm package. Starter creation does not run Dusk Forge or download a moving upstream template.</p>
            <CompanionActionButton companionStatus={companionStatus} setRoute={setRoute} onAction={scaffoldForge} disabled={!accessComplete || scaffoldState === "loading" || scaffoldState === "success" || scaffoldRecoverable || Boolean(commandInputError)}>
              Create and verify DuskDS starter
            </CompanionActionButton>
            {scaffoldState === "idle"
              ? <p className="quiet-note">{scaffoldMessage}</p>
              : <AsyncNotice state={scaffoldState} message={scaffoldMessage} onRetry={accessComplete && (scaffoldRecoverable || scaffoldState === "unavailable") ? scaffoldForge : undefined} />}
            {files.length && createdProjectPath ? (
              <>
                <FileEvidence files={files} projectPath={createdProjectPath} />
                <div className="tool-command">
                  <h3>Record the starter source snapshot</h3>
                  <p>Run this in your terminal, then use the printed tree ID as the source identity below. The command enters the exact created path and does not require a Git author identity.</p>
                  <pre>{commands?.revision}</pre>
                  {commands ? <CopyButton value={commands.revision} label="Copy source snapshot command" /> : null}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="focus-card wide">
            <StatusPill tone="neutral">Run locally with npm</StatusPill>
            <h2>Start Local Studio to create the reviewed starter</h2>
            <p>The hosted guide cannot create files. Local Studio can create the new starter inside its approved project root; the complete manual commands remain available as a fallback.</p>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={() => setRoute("companion")}>Open Local Studio setup</button>
              <button className="secondary-button" type="button" onClick={continueBuildManually}>Continue manually</button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="focus-card wide">
            <h2 ref={manualBuildHeadingRef} tabIndex={-1}>{projectMode === "new" ? "Create the reviewed starter" : "Check the existing project"}</h2>
            {projectMode === "new" ? (
              <div className="manual-record-notice">
                <StatusPill tone="warn">Required before Prepare project</StatusPill>
                <h3>Check the Node runtime used by npm</h3>
                <p>Setup covers the native Rust toolchain. The public template creator is a separate npm command and requires Node.js <strong>{DUSK_STUDIO_NODE_ENGINE}</strong>. The Prepare project command repeats this guard before creating a folder or downloading the package.</p>
                <div className="tool-command">
                  <span>Check Node and npm</span>
                  <pre>{starterNodeRuntimeGuard(platform).join(platform === "windows" ? "\r\n" : "\n")}</pre>
                  <CopyButton
                    value={starterNodeRuntimeGuard(platform).join(platform === "windows" ? "\r\n" : "\n")}
                    label="Copy Node and npm prerequisite check"
                  />
                </div>
              </div>
            ) : null}
            {commands ? (
              projectMode === "new"
                ? <CommandPair firstTitle="Prepare project" first={commands.prepare} secondTitle="Record source snapshot" second={commands.revision} />
                : <CommandPair firstTitle="Verify clean source + record full commit" first={commands.revision} secondTitle="Prepare project (rechecks clean source first)" second={commands.prepare} />
            ) : <p className="quiet-note">{commandContextPrompt}</p>}
            {projectMode === "existing" ? (
              <div className="manual-record-notice">
                <StatusPill tone="warn">Writable checkout required</StatusPill>
                <p>The existing-project lane must write build artifacts and may update ignored tool output. If this checkout is read-only, create a writable clone or worktree in a trusted location and use that path instead. The first command records the clean Git baseline before any project tool runs; Prepare project repeats that guard.</p>
                <button className="secondary-button" type="button" onClick={() => {
                  try {
                    window.sessionStorage.setItem("dusk-studio-troubleshooting-focus", "duskds-existing-repository-read-only");
                  } catch {
                    // The route remains usable when session storage is disabled.
                  }
                  setRoute("troubleshooting");
                }}>Open read-only repository recovery</button>
              </div>
            ) : null}
            <ManualRecordNotice>
              Confirm the two required files and save the full Git tree or commit ID printed by the command. A new starter uses a tree ID so first-time Git users do not need to invent an author identity. For an existing repository, this is the initial Git-tracked source identity; you must revalidate the same commit and clean unignored working tree after building, testing, and hashing. Ignored local files are outside this evidence and must not be build inputs. The project path is deliberately not stored.
            </ManualRecordNotice>
            <div className="evidence-confirmations" role="group" aria-label="Required project structure confirmations" aria-describedby={structureErrorTarget === "checks" || structureErrorTarget === "clean" ? "duskds-build-structure-error" : undefined}>
              <button ref={cargoConfirmationRef} type="button" aria-pressed={cargoConfirmed} onClick={() => {
                invalidateRecordedBuildContext();
                setStructureError("");
                setStructureErrorTarget(null);
                setCargoConfirmed((value) => !value);
                setArtifactInput((current) => ({ ...current, revision: "" }));
                setTestsPassed(false);
              }}>
                {cargoConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                Cargo.toml is present
              </button>
              <button ref={toolchainConfirmationRef} type="button" aria-pressed={toolchainConfirmed} onClick={() => {
                invalidateRecordedBuildContext();
                setStructureError("");
                setStructureErrorTarget(null);
                setToolchainConfirmed((value) => !value);
                setArtifactInput((current) => ({ ...current, revision: "" }));
                setTestsPassed(false);
              }}>
                {toolchainConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                rust-toolchain.toml pins {DUSKDS_RUST_TOOLCHAIN}
              </button>
              {projectMode === "existing" ? (
                <button ref={cleanTreeConfirmationRef} type="button" aria-pressed={cleanTreeConfirmed} onClick={() => {
                  invalidateRecordedBuildContext();
                  setStructureError("");
                  setStructureErrorTarget(null);
                  setCleanTreeConfirmed((value) => !value);
                  setPostBuildSourceConfirmed(false);
                  setArtifactInput((current) => ({ ...current, revision: "" }));
                  setTestsPassed(false);
                }}>
                  {cleanTreeConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                  Initial git status reported no tracked or untracked changes
                </button>
              ) : null}
            </div>
            <label>Source identity<input ref={structureRevisionRef} value={structureRevision} aria-invalid={structureErrorTarget === "revision" || undefined} aria-describedby={structureErrorTarget === "revision" ? "duskds-build-structure-error" : undefined} onChange={(event) => {
              if (event.target.value !== structureRevision) {
                invalidateRecordedBuildContext();
                setStructureRevision(event.target.value);
                setStructureError("");
                setStructureErrorTarget(null);
                setArtifactInput((current) => ({ ...current, revision: "" }));
                setTestsPassed(false);
                setPostBuildSourceConfirmed(false);
              }
            }} placeholder="40 or 64 hexadecimal characters" /></label>
            {structureError ? <p className="validation-message" id="duskds-build-structure-error" role="alert">{structureError}</p> : null}
            <button className="primary-button" type="button" disabled={!accessComplete} onClick={recordManualStructure}>Save manual structure confirmation</button>
            {!accessComplete ? <p className="quiet-note">Complete or skip Access before saving Build evidence.</p> : null}
          </div>
        </>
      )}
      {method === "manual" || (projectMode === "new" && Boolean(createdProjectPath)) ? (
        <>
          <div className="command-context">
            <StatusPill tone="neutral">
              {platform === "windows" ? "Windows + WSL" : platform === "linux" ? "Linux" : "macOS"}
            </StatusPill>
            <span>
              Build: {platform === "windows" ? "PowerShell" : platform === "linux" ? "Linux shell" : "macOS shell"}
            </span>
            <span>
              VM tests: {platform === "windows"
                ? "Ubuntu 24.04 WSL"
                : platform === "linux"
                  ? "native Linux"
                  : "self-managed Linux required"}
            </span>
          </div>
          {commands && platform === "macos" ? (
            <>
              <div className="tool-command">
                <h3>Build contract + data-driver WASM</h3>
                <pre>{commands.build}</pre>
                <CopyButton value={commands.build} label="Copy Build contract + data-driver WASM" />
              </div>
              <div className="manual-record-notice">
                <StatusPill tone="warn">VM test needs Linux</StatusPill>
                <p>The npm runtime and Local Actions lifecycle are supported on macOS, but Studio does not present a native macOS DuskDS VM-test pass. Use a self-managed Linux environment; that handoff is not automated or reviewed by Studio.</p>
              </div>
            </>
          ) : commands ? (
            <CommandPair firstTitle="Build contract + data-driver WASM" first={commands.build} secondTitle="Run the VM test" second={commands.test} />
          ) : <p className="quiet-note">{commandContextPrompt}</p>}
          {platform === "windows" && wslTool ? (
            <div className="focus-card wide">
              <StatusPill tone="warn">required before VM evidence</StatusPill>
              <h2>Verify the reviewed Ubuntu VM-test environment</h2>
              <p>This fail-closed check verifies Ubuntu 24.04, Make, jq, native wasm-opt, Rust {DUSKDS_RUST_TOOLCHAIN} with WASM target and rust-src, and the exact reviewed Dusk Forge Cargo receipt before a Windows VM-test pass can be saved.</p>
              <pre>{wslTool.checkCommand.windows}</pre>
              <CopyButton value={wslTool.checkCommand.windows} label="Copy reviewed WSL environment check" />
              {wslTool.installCommand ? (
                <>
                  <h3>Install or repair the reviewed WSL lane</h3>
                  <pre>{wslTool.installCommand.windows}</pre>
                  <CopyButton value={wslTool.installCommand.windows} label="Copy WSL install or repair command" />
                </>
              ) : null}
              <ExternalLink href={wslTool.helpUrl}>Official WSL installation help</ExternalLink>
              <button className="evidence-toggle" type="button" aria-pressed={vmEnvironmentConfirmed} onClick={() => {
                if (buildProgress.evidence.includes("duskds-vm-test-attestation")) {
                  journey.removeEvidence("duskds", "build", ["duskds-vm-test-attestation"]);
                }
                setVmEnvironmentConfirmed((value) => !value);
                setTestsPassed(false);
              }}>
                {vmEnvironmentConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                I ran the reviewed WSL environment check successfully
              </button>
            </div>
          ) : null}
          {platform === "windows" && wasmOptTool ? (
            <div className="focus-card wide">
              <StatusPill tone="neutral">optional optimizer</StatusPill>
              <h2>Confirm wasm-opt is a native Windows executable</h2>
              <p>An extensionless npm Binaryen shim is not accepted. This check must resolve <code>wasm-opt</code> to an application ending in <code>.exe</code> before it prints the version.</p>
              <pre>{wasmOptTool.checkCommand.windows}</pre>
              <CopyButton value={wasmOptTool.checkCommand.windows} label="Copy native wasm-opt check" />
              <ExternalLink href={wasmOptTool.helpUrl}>Binaryen installation and releases</ExternalLink>
            </div>
          ) : null}
          <div className="focus-card wide">
            <h2>Record the two built artifacts</h2>
            <p>Run these read-only inspection commands, then enter only basenames, hashes, byte sizes, and the same source identity recorded above. Absolute paths and terminal output are rejected.</p>
            {artifactCommands ? (
              <CommandPair firstTitle="Locate WASM files and byte sizes" first={artifactCommands.locate} secondTitle="Calculate WASM SHA-256 values" second={artifactCommands.hash} />
            ) : <p className="quiet-note">{commandContextPrompt}</p>}
            {projectMode === "existing" ? (
              <div className="manual-record-notice">
                <StatusPill tone="warn">Required after build, VM test, and hashing</StatusPill>
                <h3>Revalidate the exact Git source before saving</h3>
                <p>Run this as the final terminal check. It fails if HEAD changed or Git reports tracked or untracked non-ignored changes. The claim is deliberately limited to the saved commit plus its clean unignored working tree; ignored local files are not covered and must not influence the build.</p>
                {artifactCommands?.source ? (
                  <>
                    <pre>{artifactCommands.source}</pre>
                    <CopyButton value={artifactCommands.source} label="Copy final Git source check" />
                  </>
                ) : <p className="quiet-note">Save a valid initial source identity to generate the final check.</p>}
                <button ref={postBuildSourceConfirmationRef} className="evidence-toggle" type="button" disabled={!artifactCommands?.source} aria-pressed={postBuildSourceConfirmed} onClick={() => {
                  if (buildProgress.evidence.includes("duskds-build-artifact-attestation") || buildProgress.evidence.includes("duskds-vm-test-attestation")) {
                    journey.removeEvidence("duskds", "build", ["duskds-build-artifact-attestation", "duskds-vm-test-attestation"]);
                  }
                  setPostBuildSourceConfirmed((value) => !value);
                  setTestsPassed(false);
                  setArtifactError("");
                  setArtifactInvalidField(null);
                }}>
                  {postBuildSourceConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                  I ran the final Git source check after build, VM test, and artifact hashing
                </button>
              </div>
            ) : null}
            <ArtifactEvidenceForm
              value={artifactInput}
              onChange={changeArtifactInput}
              invalidField={artifactInvalidField}
              errorId={artifactError ? "duskds-build-artifact-error" : undefined}
              inputRef={(field, input) => { artifactFieldRefs.current[field] = input; }}
            />
            {artifactError ? <p className="validation-message" id="duskds-build-artifact-error" role="alert">{artifactError}</p> : null}
            <button className="primary-button" type="button" disabled={!accessComplete || !structureReady} onClick={recordArtifacts}>Save manual artifact evidence</button>
            {!structureReady ? <p className="quiet-note">Save the starter or existing-project structure first.</p> : null}
          </div>
          {platform !== "macos" ? <div className="focus-card wide">
            <h2>Record the VM test separately</h2>
            <p>A successful build does not prove the VM test passed. Confirm only after the reviewed Forge test command exits successfully in the Linux lane.</p>
            {platform === "windows" ? (
              <p className="quiet-note">The reviewed Windows lane is Ubuntu 24.04 under WSL; native Windows is not presented as verified.</p>
            ) : (
              <p className="quiet-note">The reviewed Linux VM-test lane is native Linux.</p>
            )}
            <button className="evidence-toggle" type="button" disabled={platform === "windows" && !vmEnvironmentConfirmed} aria-pressed={testsPassed} onClick={() => {
              if (buildProgress.evidence.includes("duskds-vm-test-attestation")) {
                journey.removeEvidence("duskds", "build", ["duskds-vm-test-attestation"]);
              }
              setTestsPassed((value) => !value);
            }}>
              {testsPassed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
              I observed the VM test pass in this environment
            </button>
            <button className="primary-button" type="button" disabled={!accessComplete || !structureReady || !testsPassed || !savedArtifactRevision || savedArtifactRevision !== validateRevision(artifactInput.revision || structureRevision).value || (platform === "windows" && !vmEnvironmentConfirmed)} onClick={recordTests}>
              Save manual VM-test evidence
            </button>
            {!savedArtifactRevision ? <p className="quiet-note">Save the artifact evidence before recording the VM-test pass.</p> : null}
            {platform === "windows" && !vmEnvironmentConfirmed ? <p className="quiet-note">Run and confirm the reviewed WSL environment check before recording a VM-test pass.</p> : null}
          </div> : null}
        </>
      ) : projectMode === "new" && method === "automatic" ? (
        <div className="focus-card wide">
          <h2>Build commands appear after verified creation</h2>
          <p>The Studio will use the exact absolute path returned by the successful scaffold. It does not generate copyable commands for a path that was rejected or has not been created.</p>
        </div>
      ) : null}
    </StepFrame>
  );
}

function ArtifactEvidenceForm({
  value,
  onChange,
  invalidField,
  errorId,
  inputRef
}: {
  value: {
    revision: string;
    contractName: string;
    contractSha256: string;
    contractSize: string;
    dataDriverName: string;
    dataDriverSha256: string;
    dataDriverSize: string;
  };
  onChange: (value: {
    revision: string;
    contractName: string;
    contractSha256: string;
    contractSize: string;
    dataDriverName: string;
    dataDriverSha256: string;
    dataDriverSize: string;
  }) => void;
  invalidField: BuildArtifactField | null;
  errorId?: string;
  inputRef: (field: BuildArtifactField, input: HTMLInputElement | null) => void;
}) {
  const field = (name: keyof typeof value, next: string) => onChange({ ...value, [name]: next });
  const invalidProps = (name: BuildArtifactField) => ({
    "aria-invalid": invalidField === name || undefined,
    "aria-describedby": invalidField === name ? errorId : undefined
  });
  return (
    <div className="artifact-form">
      <label>Artifact source identity<input ref={(input) => inputRef("revision", input)} value={value.revision} {...invalidProps("revision")} onChange={(event) => field("revision", event.target.value)} placeholder="40 or 64 hexadecimal characters" /></label>
      <fieldset>
        <legend>Contract WASM</legend>
        <label>Filename<input ref={(input) => inputRef("contractName", input)} value={value.contractName} {...invalidProps("contractName")} onChange={(event) => field("contractName", event.target.value)} placeholder="counter_contract.wasm" /></label>
        <label>SHA-256<input ref={(input) => inputRef("contractSha256", input)} value={value.contractSha256} {...invalidProps("contractSha256")} onChange={(event) => field("contractSha256", event.target.value)} placeholder="64 hexadecimal characters" /></label>
        <label>Size in bytes<input ref={(input) => inputRef("contractSize", input)} inputMode="numeric" value={value.contractSize} {...invalidProps("contractSize")} onChange={(event) => field("contractSize", event.target.value)} /></label>
      </fieldset>
      <fieldset>
        <legend>Data-driver WASM</legend>
        <label>Filename<input ref={(input) => inputRef("dataDriverName", input)} value={value.dataDriverName} {...invalidProps("dataDriverName")} onChange={(event) => field("dataDriverName", event.target.value)} placeholder="counter_data_driver.wasm" /></label>
        <label>SHA-256<input ref={(input) => inputRef("dataDriverSha256", input)} value={value.dataDriverSha256} {...invalidProps("dataDriverSha256")} onChange={(event) => field("dataDriverSha256", event.target.value)} placeholder="64 hexadecimal characters" /></label>
        <label>Size in bytes<input ref={(input) => inputRef("dataDriverSize", input)} inputMode="numeric" value={value.dataDriverSize} {...invalidProps("dataDriverSize")} onChange={(event) => field("dataDriverSize", event.target.value)} /></label>
      </fieldset>
    </div>
  );
}

function FileEvidence({ files, projectPath }: { files: string[]; projectPath: string }) {
  return (
    <div className="file-evidence">
      <div><strong>{files.length} relative filenames returned</strong></div>
      <p>Created at <code>{projectPath}</code></p>
      <ul>{files.slice(0, 12).map((file) => <li key={file}><code>{file}</code></li>)}</ul>
      <small>This absolute path is held only in this tab's active memory to build the next commands. It is not written to browser storage, journey evidence, or diagnostics.</small>
    </div>
  );
}

function DuskDsInspect({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const inspectProgress = journey.progress.paths.duskds.inspect;
  const buildComplete = hasTruthfulDisposition(journey.progress.paths.duskds.build.status);
  const savedInspectEvidence = new Map(inspectProgress.evidenceEntries.map((entry) => [entry.code, entry]));
  const savedBlock = savedInspectEvidence.get("duskds-inspect-latest-block");
  const savedRevision = savedInspectEvidence.get("duskds-inspect-artifact-revision")?.metadata?.revision ?? "";
  const savedAvailability = savedInspectEvidence.get("duskds-inspect-driver-availability");
  const savedSchema = savedInspectEvidence.get("duskds-inspect-driver-schema");
  const savedEncode = savedInspectEvidence.get("duskds-inspect-driver-encode");
  const savedDecode = savedInspectEvidence.get("duskds-inspect-driver-decode");
  const savedDriverIdentity = savedAvailability ?? savedSchema ?? savedEncode ?? savedDecode;
  const restoredBlockObservation = savedBlock
    && typeof savedBlock.metadata?.blockHeight === "number"
    && typeof savedBlock.metadata.blockHash === "string"
    ? {
        height: savedBlock.metadata.blockHeight,
        hash: savedBlock.metadata.blockHash,
        endpoint: savedBlock.metadata.endpoint ?? DUSKDS_TESTNET_NODE,
        observedAt: savedBlock.observedAt
      }
    : null;
  const [blockMethod, setBlockMethod] = useState<CompletionMethod>(savedBlock?.method ?? "automatic");
  const [blockHeight, setBlockHeight] = useState(savedBlock?.metadata?.blockHeight?.toString() ?? "");
  const [blockHash, setBlockHash] = useState(savedBlock?.metadata?.blockHash ?? "");
  const [blockError, setBlockError] = useState("");
  const [blockInvalidField, setBlockInvalidField] = useState<BlockObservationField | null>(null);
  const blockHeightRef = useRef<HTMLInputElement>(null);
  const blockHashRef = useRef<HTMLInputElement>(null);
  const [blockState, setBlockState] = useState<AsyncState>(restoredBlockObservation ? "success" : "idle");
  const [blockMessage, setBlockMessage] = useState(
    restoredBlockObservation
      ? `Saved observation: latest block ${restoredBlockObservation.height} at ${new Date(restoredBlockObservation.observedAt).toLocaleString()}.`
      : "Latest-block inspection has not run."
  );
  const [observation, setObservation] = useState<DuskDsBlockObservation | null>(restoredBlockObservation);
  const [revision, setRevision] = useState(savedRevision);
  const [revisionError, setRevisionError] = useState("");
  const revisionRef = useRef<HTMLInputElement>(null);
  const [driverChecks, setDriverChecks] = useState({
    availability: Boolean(savedAvailability),
    schema: Boolean(savedSchema),
    encode: Boolean(savedEncode),
    decode: Boolean(savedDecode)
  });
  const [driverInput, setDriverInput] = useState({
    contractId: savedDriverIdentity?.metadata?.contractId ?? "",
    functionName: savedEncode?.metadata?.functionName ?? savedDecode?.metadata?.functionName ?? "",
    availabilitySha256: savedAvailability?.metadata?.responseSha256 ?? "",
    schemaSha256: savedSchema?.metadata?.responseSha256 ?? "",
    encodeSha256: savedEncode?.metadata?.responseSha256 ?? "",
    decodeSha256: savedDecode?.metadata?.responseSha256 ?? ""
  });
  const [driverErrors, setDriverErrors] = useState({
    availability: "",
    schema: "",
    encode: "",
    decode: ""
  });
  type DriverErrorTarget = DriverObservationField | "confirmation" | "availability";
  const [driverErrorTargets, setDriverErrorTargets] = useState<Record<DriverObservationKind, DriverErrorTarget | null>>({
    availability: null,
    schema: null,
    encode: null,
    decode: null
  });
  const driverContractIdRef = useRef<HTMLInputElement>(null);
  const driverFunctionNameRef = useRef<HTMLInputElement>(null);
  const driverConfirmationRefs = useRef<Partial<Record<DriverObservationKind, HTMLButtonElement | null>>>({});
  const driverDigestRefs = useRef<Partial<Record<DriverObservationKind, HTMLInputElement | null>>>({});
  const manualInspectEvidence = (code: string) => inspectProgress.evidenceEntries
    .some((entry) => entry.code === code && entry.method === "manual");
  const normalizedDriverContractId = driverInput.contractId.trim().replace(/^0x/i, "").toLowerCase();
  const normalizedInspectRevision = revision.trim().toLowerCase();
  const driverRoutesAvailable = Boolean(
    savedAvailability
      && savedAvailability.metadata?.contractId === normalizedDriverContractId
      && savedAvailability.metadata.revision === normalizedInspectRevision
  );
  const metadataRequests: ResponseFetchSpec[] = [{
    key: "metadata",
    file: "metadata-response.bin",
    url: `${DUSKDS_TESTNET_NODE}/on/contract:<contract_id>/metadata`
  }];
  const metadataReadCommands = {
    linux: buildPosixResponseTransaction(metadataRequests, "linux"),
    macos: buildPosixResponseTransaction(metadataRequests, "macos"),
    windows: buildPowerShellResponseTransaction(metadataRequests)
  };
  const driverRequests: ResponseFetchSpec[] = [
    {
      key: "schema",
      file: "schema-response.bin",
      url: `${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/get_schema`
    },
    {
      key: "encode",
      file: "encode-response.bin",
      url: `${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/encode_input_fn:<fn_name>`,
      body: "<json_input>"
    },
    {
      key: "decode",
      file: "decode-response.bin",
      url: `${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/decode_output_fn:<fn_name>`,
      body: "0x<encoded_output>"
    }
  ];
  const driverReadCommands = {
    linux: buildPosixResponseTransaction(driverRequests, "linux"),
    macos: buildPosixResponseTransaction(driverRequests, "macos"),
    windows: buildPowerShellResponseTransaction(driverRequests)
  };
  const driverKinds = ["availability", "schema", "encode", "decode"] as const;
  const driverEvidenceCodes = [
    "duskds-inspect-driver-availability",
    "duskds-inspect-driver-schema",
    "duskds-inspect-driver-encode",
    "duskds-inspect-driver-decode"
  ] as const;
  const driverDigestKey = {
    availability: "availabilitySha256",
    schema: "schemaSha256",
    encode: "encodeSha256",
    decode: "decodeSha256"
  } as const;

  async function runLatestBlockRead() {
    if (blockState === "loading") return;
    setBlockState("loading");
    setBlockMessage("Reading one latest-block header from the public DuskDS Testnet node.");
    setObservation(null);
    try {
      const result = await readLatestDuskDsBlock();
      setObservation(result);
      setBlockState("success");
      setBlockMessage(`Observed latest block ${result.height}.`);
      journey.record("duskds", "inspect", ["duskds-inspect-latest-block"], {
        method: "automatic",
        observedAt: result.observedAt,
        metadata: {
          source: "browser-check",
          tool: "rpc",
          platform: "browser",
          blockHeight: result.height,
          blockHash: result.hash,
          endpoint: result.endpoint
        }
      });
    } catch (error) {
      setBlockState(stateForError(error));
      setBlockMessage(error instanceof Error ? error.message : "Latest-block inspection failed.");
      journey.block("duskds", "inspect", "duskds-public-node-unavailable");
    }
  }

  function recordManualBlock() {
    const result = validateBlockObservation(blockHeight, blockHash);
    if (!result.value) {
      setBlockError(result.error ?? "Enter the observed block result.");
      setBlockInvalidField(result.field ?? null);
      window.requestAnimationFrame(() => {
        if (result.field === "height") blockHeightRef.current?.focus();
        if (result.field === "hash") blockHashRef.current?.focus();
      });
      return;
    }
    setBlockError("");
    setBlockInvalidField(null);
    journey.record("duskds", "inspect", ["duskds-inspect-latest-block"], {
      method: "manual",
      metadata: result.value
    });
  }

  function changeInspectBlockHeight(next: string) {
    if (next !== blockHeight && manualInspectEvidence("duskds-inspect-latest-block")) {
      journey.removeEvidence("duskds", "inspect", ["duskds-inspect-latest-block"]);
    }
    if (blockInvalidField === "height") {
      setBlockError("");
      setBlockInvalidField(null);
    }
    setBlockHeight(next);
  }

  function changeInspectBlockHash(next: string) {
    if (next !== blockHash && manualInspectEvidence("duskds-inspect-latest-block")) {
      journey.removeEvidence("duskds", "inspect", ["duskds-inspect-latest-block"]);
    }
    if (blockInvalidField === "hash") {
      setBlockError("");
      setBlockInvalidField(null);
    }
    setBlockHash(next);
  }

  function changeInspectRevision(next: string) {
    if (next !== revision) {
      journey.removeEvidence("duskds", "inspect", [
        "duskds-inspect-artifact-revision",
        ...driverEvidenceCodes
      ]);
      setDriverChecks({ availability: false, schema: false, encode: false, decode: false });
      setDriverInput((current) => ({
        ...current,
        availabilitySha256: "",
        schemaSha256: "",
        encodeSha256: "",
        decodeSha256: ""
      }));
      setDriverErrors({ availability: "", schema: "", encode: "", decode: "" });
      setDriverErrorTargets({ availability: null, schema: null, encode: null, decode: null });
    }
    setRevisionError("");
    setRevision(next);
  }

  function driverEvidenceCode(kind: keyof typeof driverChecks) {
    if (kind === "availability") return "duskds-inspect-driver-availability" as const;
    if (kind === "schema") return "duskds-inspect-driver-schema" as const;
    if (kind === "encode") return "duskds-inspect-driver-encode" as const;
    return "duskds-inspect-driver-decode" as const;
  }

  function clearDriverKinds(kinds: readonly (keyof typeof driverChecks)[]) {
    journey.removeEvidence("duskds", "inspect", kinds.map(driverEvidenceCode));
    setDriverChecks((current) => {
      const next = { ...current };
      for (const kind of kinds) next[kind] = false;
      return next;
    });
    setDriverInput((current) => {
      const next = { ...current };
      for (const kind of kinds) next[driverDigestKey[kind]] = "";
      return next;
    });
    setDriverErrors((current) => {
      const next = { ...current };
      for (const kind of kinds) next[kind] = "";
      return next;
    });
    setDriverErrorTargets((current) => {
      const next = { ...current };
      for (const kind of kinds) next[kind] = null;
      return next;
    });
  }

  function changeDriverIdentity(field: "contractId" | "functionName", next: string) {
    if (next !== driverInput[field]) {
      clearDriverKinds(field === "contractId" ? driverKinds : ["encode", "decode"]);
    }
    setDriverInput((current) => ({ ...current, [field]: next }));
  }

  function toggleDriverCheck(kind: keyof typeof driverChecks) {
    if (driverChecks[kind]) {
      clearDriverKinds(kind === "availability" ? driverKinds : [kind]);
      return;
    }
    setDriverChecks((current) => ({ ...current, [kind]: true }));
    setDriverErrors((current) => ({ ...current, [kind]: "" }));
    setDriverErrorTargets((current) => ({ ...current, [kind]: null }));
  }

  function changeDriverDigest(kind: keyof typeof driverChecks, next: string) {
    const key = driverDigestKey[kind];
    if (next !== driverInput[key]) {
      const hasRecordedEvidence = inspectProgress.evidenceEntries
        .some((entry) => entry.code === driverEvidenceCode(kind));
      if (hasRecordedEvidence) {
        clearDriverKinds(kind === "availability" ? driverKinds : [kind]);
      } else {
        setDriverErrors((current) => ({ ...current, [kind]: "" }));
        setDriverErrorTargets((current) => ({ ...current, [kind]: null }));
      }
    }
    setDriverInput((current) => ({ ...current, [key]: next }));
  }

  function setDriverError(kind: DriverObservationKind, message: string, target: DriverErrorTarget | null) {
    setDriverErrors((current) => ({ ...current, [kind]: message }));
    setDriverErrorTargets((current) => ({ ...current, [kind]: target }));
    if (!target) return;
    window.requestAnimationFrame(() => {
      if (target === "contractId") driverContractIdRef.current?.focus();
      else if (target === "functionName") driverFunctionNameRef.current?.focus();
      else if (target === "responseSha256") driverDigestRefs.current[kind]?.focus();
      else if (target === "confirmation") driverConfirmationRefs.current[kind]?.focus();
      else driverConfirmationRefs.current.availability?.focus();
    });
  }

  function recordRevision() {
    if (!buildComplete) return;
    const result = validateRevision(revision);
    if (!result.value) {
      setRevisionError(result.error ?? "Enter the source identity.");
      window.requestAnimationFrame(() => revisionRef.current?.focus());
      return;
    }
    const buildRevision = getDuskDsBuildSourceRevision(journey.progress);
    if (!buildRevision) {
      setRevisionError("Return to Build and record matching artifact and VM-test source identities first.");
      window.requestAnimationFrame(() => revisionRef.current?.focus());
      return;
    }
    if (result.value !== buildRevision) {
      setRevisionError("Use the same source identity recorded for both Build artifacts and the VM test.");
      window.requestAnimationFrame(() => revisionRef.current?.focus());
      return;
    }
    setRevisionError("");
    const recordedRevision = journey.progress.paths.duskds.inspect.evidenceEntries
      .find((entry) => entry.code === "duskds-inspect-artifact-revision")
      ?.metadata?.revision;
    if (recordedRevision && recordedRevision !== result.value) journey.invalidate("duskds", "inspect");
    journey.record("duskds", "inspect", ["duskds-inspect-artifact-revision"], {
      method: "manual",
      metadata: {
        source: "manual-confirmation",
        tool: "git",
        revision: result.value
      }
    });
  }

  function recordDriverCheck(kind: keyof typeof driverChecks) {
    if (!buildComplete) return;
    const checkedRevision = validateRevision(revision);
    if (!checkedRevision.value) {
      setRevisionError(checkedRevision.error ?? "Record the source identity first so every driver observation is tied to the same build.");
      window.requestAnimationFrame(() => revisionRef.current?.focus());
      return;
    }
    const recordedRevision = journey.progress.paths.duskds.inspect.evidenceEntries
      .find((entry) => entry.code === "duskds-inspect-artifact-revision")
      ?.metadata?.revision;
    if (!recordedRevision || recordedRevision !== checkedRevision.value) {
      setRevisionError("Save this exact source identity before recording driver observations.");
      window.requestAnimationFrame(() => revisionRef.current?.focus());
      return;
    }
    if (!driverChecks[kind]) {
      setDriverError(kind, `Confirm the ${kind} result you observed before saving it.`, "confirmation");
      return;
    }
    const normalizedContractId = driverInput.contractId.trim().replace(/^0x/i, "").toLowerCase();
    if (kind !== "availability") {
      const availability = journey.progress.paths.duskds.inspect.evidenceEntries
        .find((entry) => entry.code === "duskds-inspect-driver-availability");
      if (
        availability?.metadata?.contractId !== normalizedContractId
        || availability.metadata.revision !== checkedRevision.value
      ) {
        setDriverError(kind, "First confirm that this contract's metadata reports driver_available: true.", "availability");
        return;
      }
    }
    const digest = kind === "availability"
      ? driverInput.availabilitySha256
      : kind === "schema"
        ? driverInput.schemaSha256
        : kind === "encode"
          ? driverInput.encodeSha256
          : driverInput.decodeSha256;
    const observation = validateDriverObservation(kind, {
      contractId: driverInput.contractId,
      functionName: driverInput.functionName,
      responseSha256: digest
    });
    if (!observation.value) {
      setDriverError(kind, observation.error ?? `Enter the bounded ${kind} observation.`, observation.field ?? null);
      return;
    }
    setDriverError(kind, "", null);
    const code = driverEvidenceCode(kind);
    journey.record("duskds", "inspect", [code], {
      method: "manual",
      metadata: {
        ...observation.value,
        revision: checkedRevision.value
      }
    });
  }

  function openDataDriverRecovery() {
    try {
      window.sessionStorage.setItem("dusk-studio-troubleshooting-focus", "duskds-driver-unavailable-after-deploy");
    } catch {
      // The route remains usable when session storage is disabled.
    }
    setRoute("troubleshooting");
  }

  function focusInspectSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus();
  }

  function driverErrorIdsForTarget(target: DriverObservationField): string | undefined {
    return driverKinds
      .filter((kind) => driverErrorTargets[kind] === target)
      .map((kind) => `duskds-${kind}-observation-error`)
      .join(" ") || undefined;
  }

  function driverCheckRow(kind: keyof typeof driverChecks) {
    const disabled = !buildComplete || (kind !== "availability" && !driverRoutesAvailable);
    const digest = driverInput[driverDigestKey[kind]];
    const errorId = `duskds-${kind}-observation-error`;
    const confirmationErrorIds = driverKinds
      .filter((candidate) => kind === "availability"
        ? driverErrorTargets[candidate] === "availability"
          || (candidate === "availability" && driverErrorTargets[candidate] === "confirmation")
        : candidate === kind && driverErrorTargets[candidate] === "confirmation")
      .map((candidate) => `duskds-${candidate}-observation-error`)
      .join(" ") || undefined;
    const digestInvalid = driverErrorTargets[kind] === "responseSha256";
    return (
      <div className="inspection-check" key={kind}>
        <button
          className="evidence-toggle"
          ref={(button) => { driverConfirmationRefs.current[kind] = button; }}
          type="button"
          aria-pressed={driverChecks[kind]}
          aria-invalid={Boolean(confirmationErrorIds) || undefined}
          aria-describedby={confirmationErrorIds}
          disabled={disabled}
          onClick={() => toggleDriverCheck(kind)}
        >
          {driverChecks[kind] ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
          {kind === "availability"
            ? "I observed driver_available: true in contract metadata"
            : kind === "schema"
              ? "I observed a non-empty schema"
              : kind === "encode"
                ? "I observed valid input encoding"
                : "I observed valid output decoding"}
        </button>
        <label>
          {kind === "availability" ? "Metadata" : kind === "schema" ? "Schema" : kind === "encode" ? "Encode" : "Decode"} response SHA-256
          <input
            ref={(input) => { driverDigestRefs.current[kind] = input; }}
            value={digest}
            disabled={disabled}
            aria-invalid={digestInvalid || undefined}
            aria-describedby={digestInvalid ? errorId : undefined}
            onChange={(event) => changeDriverDigest(kind, event.target.value)}
            placeholder="64 hexadecimal characters"
          />
        </label>
        <button className="secondary-button" type="button" disabled={disabled} onClick={() => recordDriverCheck(kind)}>
          Save {kind === "availability" ? "availability" : kind} confirmation
        </button>
        {driverErrors[kind] ? <p className="validation-message inspection-error" id={errorId} role="alert">{driverErrors[kind]}</p> : null}
      </div>
    );
  }

  return (
    <StepFrame
      builderPath="duskds"
      route="inspect"
      setRoute={setRoute}
      helper={<ExternalLink href="https://docs.dusk.network/developer/integrations/http-api/">Official Dusk HTTP API</ExternalLink>}
    >
      <nav className="filter-bar" aria-label="Inspect sections">
        <button type="button" onClick={() => focusInspectSection("duskds-latest-block")}>1. Latest block</button>
        <button type="button" onClick={() => focusInspectSection("duskds-source-identity")}>2. Source identity</button>
        <button type="button" onClick={() => focusInspectSection("duskds-deploy-readiness")}>3. Deployment readiness</button>
        <button type="button" onClick={() => focusInspectSection("duskds-post-deploy-inspection")}>4. Data driver</button>
      </nav>
      {!buildComplete ? <AsyncNotice state="partial" title="Build evidence is still incomplete" message="The independent latest-block observation remains available. Source identity, deployment readiness, and data-driver evidence stay disabled until Build has a truthful disposition." /> : null}
      <div className="focus-card wide" id="duskds-latest-block" tabIndex={-1}>
        <h2>1. Observe a latest block</h2>
        <p>Choose a direct hosted read or enter the bounded height and hash you observed yourself. This is independent from the artifact and data-driver checks.</p>
        <CompletionMethodPicker
          value={blockMethod}
          onChange={setBlockMethod}
          automaticAvailable
          automaticLabel="Hosted safe check"
          automaticDescription="One bounded, read-only public-node request from this browser. No companion or wallet is used."
          automaticAvailabilityLabel="available here"
        />
        {blockMethod === "automatic" ? (
          <>
            <button
              className="primary-button"
              type="button"
              aria-disabled={blockState === "loading"}
              onClick={runLatestBlockRead}
            >
              Read latest block
            </button>
            {blockState === "idle"
              ? <p className="quiet-note">{blockMessage}</p>
              : <AsyncNotice state={blockState} message={blockMessage} onRetry={blockState === "error" || blockState === "timeout" || blockState === "unavailable" ? runLatestBlockRead : undefined} />}
            {observation ? <BlockReceipt observation={observation} label="Automatic browser observation" /> : null}
          </>
        ) : (
          <>
            <div className="evidence-form">
              <label>Block height<input ref={blockHeightRef} inputMode="numeric" value={blockHeight} aria-invalid={blockInvalidField === "height" || undefined} aria-describedby={blockInvalidField === "height" ? "duskds-inspect-block-error" : undefined} onChange={(event) => changeInspectBlockHeight(event.target.value)} /></label>
              <label>Block hash<input ref={blockHashRef} value={blockHash} aria-invalid={blockInvalidField === "hash" || undefined} aria-describedby={blockInvalidField === "hash" ? "duskds-inspect-block-error" : undefined} onChange={(event) => changeInspectBlockHash(event.target.value)} placeholder="64 hexadecimal characters" /></label>
            </div>
            {blockError ? <p className="validation-message" id="duskds-inspect-block-error" role="alert">{blockError}</p> : null}
            <button className="primary-button" type="button" onClick={recordManualBlock}>Save manual block observation</button>
          </>
        )}
      </div>
      <div className="focus-card wide" id="duskds-source-identity" tabIndex={-1}>
        <h2>2. Bind inspection to the built source</h2>
        <p>Use the same full Git tree or commit ID recorded during Build. New Studio starters use <code>git write-tree</code>; existing repositories first require a clean tracked-and-untracked status, then use <code>git rev-parse --verify HEAD</code>. This binds post-deploy observations to the exact source state that was checked.</p>
        <label>Artifact source identity<input ref={revisionRef} value={revision} aria-invalid={Boolean(revisionError) || undefined} aria-describedby={revisionError ? "duskds-inspect-revision-error" : undefined} onChange={(event) => changeInspectRevision(event.target.value)} placeholder="40 or 64 hexadecimal characters" /></label>
        {revisionError ? <p className="validation-message" id="duskds-inspect-revision-error" role="alert">{revisionError}</p> : null}
        <button className="primary-button" type="button" disabled={!buildComplete} onClick={recordRevision}>Save source match</button>
      </div>
      <DuskDsDeployReadiness setRoute={setRoute} />
      <div className="focus-card wide" id="duskds-post-deploy-inspection" tabIndex={-1}>
        <h2>4. Return after deployment and inspect the data driver</h2>
        <p>Use the contract ID only after confirming deployment inclusion and finality outside Studio. First read <code>/on/contract:&lt;contract_id&gt;/metadata</code> and confirm <code>driver_available: true</code>. Deployment alone does not publish a data driver; if that value is false, stop here and use the recovery guidance instead of calling driver routes.</p>
        <button className="secondary-button" type="button" onClick={openDataDriverRecovery}>Open data-driver recovery</button>
        <CommandPair
          firstTitle="Fetch, inspect + hash metadata on Linux"
          first={metadataReadCommands.linux}
          secondTitle="Fetch, inspect + hash metadata on macOS"
          second={metadataReadCommands.macos}
        />
        <div className="tool-command">
          <h3>Fetch, inspect + hash metadata on Windows</h3>
          <pre>{metadataReadCommands.windows}</pre>
          <CopyButton value={metadataReadCommands.windows} label="Copy Fetch, inspect + hash metadata on Windows" />
        </div>
        <p>Inspect the saved response locally before hashing it. Confirm that metadata explicitly reports <code>driver_available: true</code>, then record only its SHA-256 in Studio. Never paste the response body or terminal output here.</p>
        <div className="evidence-form">
          <label>
            Deployed contract ID
            <input
              ref={driverContractIdRef}
              value={driverInput.contractId}
              aria-invalid={Boolean(driverErrorIdsForTarget("contractId")) || undefined}
              aria-describedby={driverErrorIdsForTarget("contractId")}
              onChange={(event) => changeDriverIdentity("contractId", event.target.value)}
              placeholder="64 hexadecimal characters"
            />
          </label>
          <label>
            Function name for encode / decode
            <input
              ref={driverFunctionNameRef}
              value={driverInput.functionName}
              aria-invalid={Boolean(driverErrorIdsForTarget("functionName")) || undefined}
              aria-describedby={driverErrorIdsForTarget("functionName")}
              onChange={(event) => changeDriverIdentity("functionName", event.target.value)}
              placeholder="increment_by"
            />
          </label>
        </div>
        <p className="quiet-note">Never paste a secret, seed phrase, signing request, private endpoint, credential, raw response, or payload into these fields. Studio stores only the checked result, source identity, contract ID, function name, endpoint origin, and response digest.</p>
        {driverCheckRow("availability")}
        {driverRoutesAvailable ? (
          <>
            <AsyncNotice state="success" message="This contract's saved metadata evidence reports driver_available: true. Driver read commands are now available." />
            <CommandPair
              firstTitle="Fetch, inspect + hash driver responses on Linux"
              first={driverReadCommands.linux}
              secondTitle="Fetch, inspect + hash driver responses on macOS"
              second={driverReadCommands.macos}
            />
            <div className="tool-command">
              <h3>Fetch, inspect + hash driver responses on Windows</h3>
              <pre>{driverReadCommands.windows}</pre>
              <CopyButton value={driverReadCommands.windows} label="Copy Fetch, inspect + hash driver responses on Windows" />
            </div>
          </>
        ) : (
          <AsyncNotice state="partial" message="Driver routes stay disabled until you save metadata evidence for this exact contract and source identity with driver_available: true." />
        )}
        {(["schema", "encode", "decode"] as const).map(driverCheckRow)}
      </div>
      <MiniSteps items={[
        "Observe one current block through the hosted read or a bounded manual record.",
        "Bind Inspect to the exact source identity recorded during Build.",
        "Review readiness, then run Rusk Wallet manually without giving Studio wallet access.",
        "Return after finality, confirm driver availability, then record schema, input encoding, and output decoding separately."
      ]} />
    </StepFrame>
  );
}
