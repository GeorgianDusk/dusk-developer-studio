import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildDuskDsCommandSet,
  quotePosixArg,
  quotePowerShellArg,
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
  W3SPER_INSTALL_COMMAND,
  W3SPER_NODE_READ_SNIPPET,
  W3SPER_RUN_COMMAND,
  manualToolsFor,
  type ManualPlatform
} from "../manualJourneyConfig";
import {
  validateBlockObservation,
  validateBuildArtifacts,
  validateDriverObservation,
  validateRevision
} from "../manualEvidenceValidation";
import {
  DuskDsNodeReadError,
  readLatestDuskDsBlock,
  type DuskDsBlockObservation
} from "../duskDsNodeRead";
import { DuskDsDeployReadiness } from "../DuskDsDeployReadiness";
import { getDuskDsBuildSourceRevision } from "../deployReadiness";
import { isPreflightResult, isScaffoldEvidence, type PreflightResult } from "../responseSchemas";
import { requestJson, SafeRequestError, safeRequestMessage } from "../safeRequest";
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
import { defaultNetwork, initialCommandPlatform } from "../studioConfig";
import { useJourney, useStudioRuntime } from "../studioState";
import type { CompanionStatus, RouteId } from "../types";
import type { BuilderPath } from "../journeyProgress";

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

function platformMetadata(platform: ManualPlatform): "windows" | undefined {
  return platform === "windows" ? "windows" : undefined;
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
        <div className="button-row">
          <ExternalLink href="https://docs.dusk.network/developer/smart-contracts-dusk-evm/deploy-on-evm/">Official deployment guide</ExternalLink>
          <ExternalLink href="https://dusk.network/news/duskevm-deep-dive">DuskEVM deep dive</ExternalLink>
          <CopyButton value={defaultNetwork.rpcUrls[0]} label="Copy pre-launch RPC URL" />
        </div>
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
        <p className="quiet-note" id="evm-format-help">A hexadecimal block number such as 0x1234 is classified as a block reference, not validated against a network.</p>
        <div className="button-row" id="evm-format-result" role="status" aria-live="polite">
          <StatusPill tone={classification ? "good" : invalidIdentifier ? "danger" : "neutral"}>
            {classification?.type ?? (invalidIdentifier ? "Unrecognized shape" : "Waiting for an example")}
          </StatusPill>
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
  const [platform, setPlatform] = useState<ManualPlatform>(initialCommandPlatform === "windows" ? "windows" : "posix");
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [message, setMessage] = useState("Automatic preflight has not run.");
  const [state, setState] = useState<AsyncState>("idle");
  const requiredTools = manualToolsFor("setup").filter((tool) => tool.requirement === "required");
  const allRequiredConfirmed = requiredTools.every((tool) => confirmed.has(tool.id));
  const manualSetupRecorded = journey.progress.paths.duskds.setup.evidenceEntries
    .some((entry) => entry.code === "duskds-required-preflight" && entry.method === "manual");

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

  function changePlatform(next: ManualPlatform) {
    if (next === platform) return;
    if (manualSetupRecorded) journey.removeEvidence("duskds", "setup", ["duskds-required-preflight"]);
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
    setMessage("Running the bounded allowlisted preflight.");
    try {
      if (!companionBaseUrl) throw new Error("Local Studio is not connected.");
      const data = await requestJson(companionBaseUrl + "/preflight?path=duskds", {
        init: { credentials: "include" },
        validate: isPreflightResult,
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
        journey.block(
          "duskds",
          "setup",
          data.tools.some((tool) => tool.required && tool.failureKind === "unsupported")
            ? "unsupported-platform"
            : "toolchain-incomplete"
        );
      }
    } catch (error) {
      setState(stateForError(error));
      setMessage(safeRequestMessage(error));
      journey.block("duskds", "setup", "companion-unavailable");
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
          onChange={setMethod}
          automaticAvailable={automaticAvailable}
        />
      </div>
      {method === "manual" ? (
        <>
          <div className="focus-card wide">
            <h2>Run the required checks yourself</h2>
            <PlatformPicker value={platform} onChange={changePlatform} />
            <ManualToolChecklist scope="setup" platform={platform} confirmed={confirmed} onToggle={toggleTool} />
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
            <button className="primary-button" type="button" onClick={() => setMethod("manual")}>Continue manually</button>
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
  const [method, setMethod] = useState<CompletionMethod>("automatic");
  const [platform, setPlatform] = useState<ManualPlatform>(initialCommandPlatform === "windows" ? "windows" : "posix");
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [blockHeight, setBlockHeight] = useState("");
  const [blockHash, setBlockHash] = useState("");
  const [manualError, setManualError] = useState("");
  const [automaticState, setAutomaticState] = useState<AsyncState>("idle");
  const [automaticMessage, setAutomaticMessage] = useState("The public node has not been checked from this browser.");
  const [observation, setObservation] = useState<DuskDsBlockObservation | null>(null);
  const requiredAccessTools = manualToolsFor("access").filter((tool) => tool.requirement === "required");
  const toolsReady = requiredAccessTools.every((tool) => confirmed.has(tool.id));
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
    setPlatform(next);
  }

  function changeManualBlockHeight(next: string) {
    if (next !== blockHeight && manualAccessRecorded) {
      journey.removeEvidence("duskds", "access", ["duskds-node-read-attestation"]);
    }
    setBlockHeight(next);
  }

  function changeManualBlockHash(next: string) {
    if (next !== blockHash && manualAccessRecorded) {
      journey.removeEvidence("duskds", "access", ["duskds-node-read-attestation"]);
    }
    setBlockHash(next);
  }

  async function runHostedRead() {
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
      journey.block("duskds", "access", "rpc-unavailable");
    }
  }

  function recordManualRead() {
    const result = validateBlockObservation(blockHeight, blockHash);
    if (!result.value) {
      setManualError(result.error ?? "Enter the observed height and hash.");
      return;
    }
    setManualError("");
    journey.record("duskds", "access", ["duskds-node-read-attestation"], {
      method: "manual",
      metadata: {
        ...result.value,
        platform: platformMetadata(platform)
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
        <CompletionMethodPicker
          value={method}
          onChange={setMethod}
          automaticAvailable
          automaticLabel="Hosted safe check"
        />
      </div>
      {method === "automatic" ? (
        <div className="focus-card wide">
          <h2>Read the public Testnet tip</h2>
          <p>This sends one bounded, read-only GraphQL request to {DUSKDS_TESTNET_NODE}. It uses no wallet, key, account, transaction, or companion.</p>
          <button className="primary-button" type="button" disabled={automaticState === "loading"} onClick={runHostedRead}>
            {automaticState === "loading" ? "Reading latest block" : observation ? "Run safe check again" : "Run hosted safe check"}
          </button>
          {automaticState === "idle"
            ? <p className="quiet-note">{automaticMessage}</p>
            : <AsyncNotice
                state={automaticState}
                message={automaticMessage}
                onRetry={automaticState === "error" || automaticState === "timeout" || automaticState === "unavailable" ? runHostedRead : undefined}
              />}
          {observation ? <BlockReceipt observation={observation} label="Automatic browser observation" /> : null}
        </div>
      ) : (
        <>
          <div className="focus-card wide">
            <h2>Run the W3sper query in a small Deno app</h2>
            <PlatformPicker value={platform} onChange={changePlatform} />
            <ManualToolChecklist scope="access" platform={platform} confirmed={confirmed} onToggle={toggleTool} />
            <CommandPair
              firstTitle="Add W3sper"
              first={W3SPER_INSTALL_COMMAND}
              secondTitle="Run the read-only script"
              second={W3SPER_RUN_COMMAND}
            />
            <h3>check-duskds.ts</h3>
            <pre>{W3SPER_NODE_READ_SNIPPET}</pre>
            <CopyButton value={W3SPER_NODE_READ_SNIPPET} label="Copy the W3sper latest-block script" />
          </div>
          <div className="focus-card wide">
            <h2>Record exactly what you observed</h2>
            <ManualRecordNotice>
              Studio validates the height and 32-byte hash format. It cannot prove that your local script produced them.
            </ManualRecordNotice>
            <div className="evidence-form">
              <label>
                Block height
                <input inputMode="numeric" value={blockHeight} onChange={(event) => changeManualBlockHeight(event.target.value)} placeholder="3820996" />
              </label>
              <label>
                Block hash
                <input value={blockHash} onChange={(event) => changeManualBlockHash(event.target.value)} placeholder="64 hexadecimal characters" />
              </label>
            </div>
            {manualError ? <p className="validation-message" role="alert">{manualError}</p> : null}
            <button className="primary-button" type="button" disabled={!toolsReady} onClick={recordManualRead}>Save manual node observation</button>
            {!toolsReady ? <p className="quiet-note">Confirm the required Access tool before saving.</p> : null}
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

function safeProjectName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "duskds-forge-starter";
}

function buildManualCommands({
  projectMode,
  projectName,
  parentDir,
  existingRoot,
  platform
}: {
  projectMode: ProjectMode;
  projectName: string;
  parentDir: string;
  existingRoot: string;
  platform: CommandPlatform;
}): {
  prepare: string;
  build: string;
  test: string;
  revision: string;
  testEnvironment: "wsl-ubuntu-24.04" | "linux";
} {
  const name = safeProjectName(projectName);
  if (projectMode === "new") {
    const commands = buildDuskDsCommandSet({ projectName: name, parentDir: parentDir.trim(), platform });
    const root = commands.projectPath.slice(0, -(name.length + 1));
    const create = platform === "windows"
      ? `dusk-forge new ${quotePowerShellArg(name)} --path ${quotePowerShellArg(root)} --no-git --template counter`
      : `dusk-forge new ${quotePosixArg(name)} --path ${quotePosixArg(root)} --no-git --template counter`;
    const enter = platform === "windows"
      ? `Set-Location -LiteralPath ${quotePowerShellArg(commands.projectPath)}`
      : `cd ${quotePosixArg(commands.projectPath)}`;
    return {
      prepare: [create, enter, `rustup override set ${DUSKDS_RUST_TOOLCHAIN}`].join("\n"),
      build: commands.build,
      test: commands.test,
      revision: [enter, "git init", "git add .", "git write-tree"].join("\n"),
      testEnvironment: platform === "windows" ? "wsl-ubuntu-24.04" : "linux"
    };
  }
  const root = existingRoot.trim() || (platform === "windows" ? "C:\\path\\to\\your-project" : "/path/to/your-project");
  const enter = platform === "windows"
    ? `Set-Location -LiteralPath ${quotePowerShellArg(root)}`
    : `cd ${quotePosixArg(root)}`;
  let test: string;
  if (platform === "windows" && /^[a-zA-Z]:[\\/]/.test(root)) {
    test = `wsl -d Ubuntu-24.04 -- bash -lc ${quotePowerShellArg(`cd ${quotePosixArg(windowsPathToWsl(root))} && dusk-forge test`)}`;
  } else if (platform === "windows") {
    test = "Use an absolute Windows drive path above, then rerun this page to generate the reviewed WSL test command.";
  } else {
    test = [enter, "dusk-forge test"].join("\n");
  }
  return {
    prepare: [enter, `rustup override set ${DUSKDS_RUST_TOOLCHAIN}`, "dusk-forge check"].join("\n"),
    build: [enter, "dusk-forge check", "dusk-forge build all"].join("\n"),
    test,
    revision: [enter, "git rev-parse HEAD"].join("\n"),
    testEnvironment: platform === "windows" ? "wsl-ubuntu-24.04" : "linux"
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
  const [method, setMethod] = useState<CompletionMethod>(automaticAvailable ? "automatic" : "manual");
  const [platform, setPlatform] = useState<CommandPlatform>(initialCommandPlatform);
  const [projectMode, setProjectMode] = useState<ProjectMode>("new");
  const [projectName, setProjectName] = useState("duskds-forge-starter");
  const [parentDir, setParentDir] = useState("");
  const [existingRoot, setExistingRoot] = useState("");
  const [structureRevision, setStructureRevision] = useState("");
  const [cargoConfirmed, setCargoConfirmed] = useState(false);
  const [toolchainConfirmed, setToolchainConfirmed] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [scaffoldMessage, setScaffoldMessage] = useState("Automatic scaffold has not run.");
  const [scaffoldState, setScaffoldState] = useState<AsyncState>("idle");
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
  const [testEnvironment, setTestEnvironment] = useState<"wsl-ubuntu-24.04" | "linux">(
    platform === "windows" ? "wsl-ubuntu-24.04" : "linux"
  );
  const [testsPassed, setTestsPassed] = useState(false);
  const commands = useMemo(
    () => buildManualCommands({ projectMode, projectName, parentDir, existingRoot, platform }),
    [existingRoot, parentDir, platform, projectMode, projectName]
  );
  const artifactCommands = platform === "windows"
    ? {
        locate: [
          "Get-ChildItem -File '.\\target\\contract\\wasm32-unknown-unknown\\release\\*.wasm' | Select-Object Name,Length",
          "Get-ChildItem -File '.\\target\\data-driver\\wasm32-unknown-unknown\\release\\*.wasm' | Select-Object Name,Length"
        ].join("\n"),
        hash: [
          "Get-FileHash -Algorithm SHA256 '.\\target\\contract\\wasm32-unknown-unknown\\release\\*.wasm'",
          "Get-FileHash -Algorithm SHA256 '.\\target\\data-driver\\wasm32-unknown-unknown\\release\\*.wasm'"
        ].join("\n")
      }
    : {
        locate: [
          "find target/contract/wasm32-unknown-unknown/release -maxdepth 1 -name '*.wasm' -exec wc -c {} \\;",
          "find target/data-driver/wasm32-unknown-unknown/release -maxdepth 1 -name '*.wasm' -exec wc -c {} \\;"
        ].join("\n"),
        hash: [
          "shasum -a 256 target/contract/wasm32-unknown-unknown/release/*.wasm",
          "shasum -a 256 target/data-driver/wasm32-unknown-unknown/release/*.wasm"
        ].join("\n")
      };
  const buildProgress = journey.progress.paths.duskds.build;
  const structureReady = buildProgress.evidence.includes("duskds-starter-structure");
  const hasRecordedBuildContext = buildProgress.evidence.length > 0
    || Boolean(buildProgress.blocker)
    || buildProgress.status === "skipped"
    || buildProgress.status === "skipped-with-reason";

  function clearDependentBuildInputs() {
    setCargoConfirmed(false);
    setToolchainConfirmed(false);
    setStructureRevision("");
    setStructureError("");
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
    setTestsPassed(false);
    setFiles([]);
  }

  function invalidateRecordedBuildContext() {
    if (hasRecordedBuildContext) journey.invalidate("duskds", "build");
  }

  function changeProjectMode(next: ProjectMode) {
    if (next === projectMode) return;
    invalidateRecordedBuildContext();
    clearDependentBuildInputs();
    setProjectMode(next);
  }

  function setBuildPlatform(next: ManualPlatform) {
    const commandPlatform = next === "windows" ? "windows" : "posix";
    if (commandPlatform === platform) return;
    invalidateRecordedBuildContext();
    clearDependentBuildInputs();
    setPlatform(commandPlatform);
    setTestEnvironment(commandPlatform === "windows" ? "wsl-ubuntu-24.04" : "linux");
  }

  function recordManualStructure() {
    const revision = validateRevision(structureRevision);
    if (!revision.value) {
      setStructureError(revision.error ?? "Enter the source identity.");
      return;
    }
    if (!cargoConfirmed || !toolchainConfirmed) {
      setStructureError("Confirm both Cargo.toml and rust-toolchain.toml before saving.");
      return;
    }
    setStructureError("");
    if (buildProgress.evidence.length > 0) journey.invalidate("duskds", "build");
    journey.record("duskds", "build", ["duskds-starter-structure"], {
      method: "manual",
      metadata: {
        source: "manual-confirmation",
        tool: "forge-starter",
        version: DUSKDS_RUST_TOOLCHAIN,
        revision: revision.value,
        platform: platform === "windows" ? "windows" : undefined,
        checkCount: 2
      }
    });
    setArtifactInput((current) => ({ ...current, revision: current.revision || revision.value || "" }));
  }

  async function scaffoldForge() {
    invalidateRecordedBuildContext();
    setFiles([]);
    setScaffoldState("loading");
    setScaffoldMessage("Creating the bounded Forge starter under the approved local root.");
    try {
      if (!companionBaseUrl) throw new Error("Local Studio is not connected.");
      const data = await requestJson(companionBaseUrl + "/scaffold-duskds-forge", {
        init: {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectName: safeProjectName(projectName), parentDir: parentDir.trim() || undefined })
        },
        validate: isScaffoldEvidence,
        maxBytes: 64 * 1024
      });
      if (!data.ok || !data.structureVerified) throw new Error("Forge structure could not be verified.");
      if (data.platform === "windows" || data.platform === "posix") setPlatform(data.platform);
      setFiles(data.files);
      setScaffoldState("success");
      setScaffoldMessage(
        `Forge structure verified with Rust ${data.rustToolchain ?? DUSKDS_RUST_TOOLCHAIN}${data.forgeRevision ? ` and Forge ${data.forgeRevision.slice(0, 12)}` : ""}.`
      );
      journey.record("duskds", "build", ["duskds-starter-structure"], {
        method: "automatic",
        metadata: {
          source: "companion",
          tool: "forge-starter",
          version: data.rustToolchain ?? DUSKDS_RUST_TOOLCHAIN,
          revision: data.forgeRevision ?? DUSKDS_FORGE_COMMIT,
          platform: data.platform === "windows" ? "windows" : data.platform === "posix" ? "linux" : data.platform,
          checkCount: data.files.length
        }
      });
    } catch (error) {
      setScaffoldState(stateForError(error));
      setScaffoldMessage(safeRequestMessage(error));
      journey.block("duskds", "build", "companion-unavailable");
    }
  }

  function recordArtifacts() {
    const result = validateBuildArtifacts(artifactInput);
    if (!result.value) {
      setArtifactError(result.error ?? "Enter the bounded artifact details.");
      return;
    }
    const manualStructure = buildProgress.evidenceEntries.find((entry) => entry.code === "duskds-starter-structure" && entry.method === "manual");
    if (manualStructure?.metadata?.revision && result.value.revision !== manualStructure.metadata.revision) {
      setArtifactError("Use the same source identity saved in the manual structure confirmation.");
      return;
    }
    setArtifactError("");
    journey.record("duskds", "build", ["duskds-build-artifact-attestation"], {
      method: "manual",
      metadata: {
        ...result.value,
        platform: platform === "windows" ? "windows" : undefined
      }
    });
  }

  function changeArtifactInput(next: typeof artifactInput) {
    const changedFields = (Object.keys(next) as Array<keyof typeof artifactInput>)
      .filter((field) => next[field] !== artifactInput[field]);
    if (changedFields.length > 0 && buildProgress.evidence.includes("duskds-build-artifact-attestation")) {
      const removals = ["duskds-build-artifact-attestation"] as const;
      const revisionChanged = changedFields.includes("revision");
      journey.removeEvidence(
        "duskds",
        "build",
        revisionChanged ? [...removals, "duskds-vm-test-attestation"] : [...removals]
      );
      if (revisionChanged) setTestsPassed(false);
    }
    setArtifactInput(next);
  }

  function recordTests() {
    const revision = validateRevision(artifactInput.revision || structureRevision);
    if (!testsPassed || !revision.value) return;
    journey.record("duskds", "build", ["duskds-vm-test-attestation"], {
      method: "manual",
      metadata: {
        source: "manual-confirmation",
        tool: "dusk-forge",
        version: DUSKDS_RUST_TOOLCHAIN,
        revision: revision.value,
        testEnvironment,
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
        <div className="method-picker compact" role="group" aria-label="Choose project type">
          <button className={projectMode === "new" ? "method-option active" : "method-option"} type="button" aria-pressed={projectMode === "new"} onClick={() => changeProjectMode("new")}>
            <span><strong>New Forge starter</strong><small>Create the reviewed Counter template.</small></span>
          </button>
          <button className={projectMode === "existing" ? "method-option active" : "method-option"} type="button" aria-pressed={projectMode === "existing"} onClick={() => changeProjectMode("existing")}>
            <span><strong>Existing repository</strong><small>Check and build your current Forge project.</small></span>
          </button>
        </div>
        <CompletionMethodPicker value={method} onChange={setMethod} automaticAvailable={automaticAvailable} />
      </div>
      <div className="focus-card wide">
        <h2>Set the command context</h2>
        <PlatformPicker value={platform === "windows" ? "windows" : "posix"} onChange={setBuildPlatform} />
        <div className="form-grid">
          {projectMode === "new" ? (
            <>
              <label>Project name<input value={projectName} onChange={(event) => {
                if (event.target.value !== projectName) {
                  invalidateRecordedBuildContext();
                  clearDependentBuildInputs();
                  setProjectName(event.target.value);
                }
              }} /></label>
              <label>Parent folder, optional<input value={parentDir} onChange={(event) => {
                if (event.target.value !== parentDir) {
                  invalidateRecordedBuildContext();
                  clearDependentBuildInputs();
                  setParentDir(event.target.value);
                }
              }} placeholder={platform === "windows" ? "Relative to C:\\tmp\\dusk-studio-projects" : "Relative to .generated"} /></label>
            </>
          ) : (
            <label>Existing project root<input value={existingRoot} onChange={(event) => {
              if (event.target.value !== existingRoot) {
                invalidateRecordedBuildContext();
                clearDependentBuildInputs();
                setExistingRoot(event.target.value);
              }
            }} placeholder={platform === "windows" ? "C:\\absolute\\path\\to\\project" : "/absolute/path/to/project"} /></label>
          )}
        </div>
        <p className="quiet-note">Paths stay in this tab and are never added to journey evidence or diagnostics.</p>
      </div>
      {method === "automatic" ? (
        automaticAvailable && projectMode === "new" ? (
          <div className="focus-card wide">
            <h2>Create and inspect the starter locally</h2>
            <p>The paired companion creates only inside its approved root, uses the exact reviewed Forge revision, and returns relative filenames plus bounded tool identities.</p>
            <CompanionActionButton companionStatus={companionStatus} setRoute={setRoute} onAction={scaffoldForge} disabled={scaffoldState === "loading"}>
              Create and verify Forge starter
            </CompanionActionButton>
            {scaffoldState === "idle"
              ? <p className="quiet-note">{scaffoldMessage}</p>
              : <AsyncNotice state={scaffoldState} message={scaffoldMessage} onRetry={scaffoldState === "error" || scaffoldState === "timeout" || scaffoldState === "unavailable" ? scaffoldForge : undefined} />}
            {files.length ? <FileEvidence files={files} /> : null}
          </div>
        ) : (
          <div className="focus-card wide">
            <StatusPill tone={automaticAvailable ? "warn" : "neutral"}>{automaticAvailable ? "Manual existing-project lane" : "Run locally with npm"}</StatusPill>
            <h2>{automaticAvailable ? "Existing repositories stay user-controlled" : "Use the complete manual build lane"}</h2>
            <p>{automaticAvailable
              ? "The companion scaffold endpoint creates a new bounded starter; it does not crawl arbitrary repositories. Continue manually for an existing project."
              : "The hosted guide cannot create files. It provides the exact reviewed commands and bounded evidence forms below."}</p>
            <button className="primary-button" type="button" onClick={() => setMethod("manual")}>Continue manually</button>
          </div>
        )
      ) : (
        <>
          <div className="focus-card wide">
            <h2>{projectMode === "new" ? "Create the reviewed starter" : "Check the existing project"}</h2>
            <CommandPair firstTitle="Prepare project" first={commands.prepare} secondTitle={projectMode === "new" ? "Record source snapshot" : "Record source revision"} second={commands.revision} />
            <ManualRecordNotice>
              Confirm the two required files and save the exact Git tree or commit ID printed by the command. A new starter uses a tree ID so first-time Git users do not need to invent an author identity. The project path is deliberately not stored.
            </ManualRecordNotice>
            <div className="evidence-confirmations">
              <button type="button" aria-pressed={cargoConfirmed} onClick={() => {
                invalidateRecordedBuildContext();
                setCargoConfirmed((value) => !value);
                setArtifactInput((current) => ({ ...current, revision: "" }));
                setTestsPassed(false);
              }}>
                {cargoConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                Cargo.toml is present
              </button>
              <button type="button" aria-pressed={toolchainConfirmed} onClick={() => {
                invalidateRecordedBuildContext();
                setToolchainConfirmed((value) => !value);
                setArtifactInput((current) => ({ ...current, revision: "" }));
                setTestsPassed(false);
              }}>
                {toolchainConfirmed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
                rust-toolchain.toml pins {DUSKDS_RUST_TOOLCHAIN}
              </button>
            </div>
            <label>Source identity<input value={structureRevision} onChange={(event) => {
              if (event.target.value !== structureRevision) {
                invalidateRecordedBuildContext();
                setStructureRevision(event.target.value);
                setArtifactInput((current) => ({ ...current, revision: "" }));
                setTestsPassed(false);
              }
            }} placeholder={projectMode === "new" ? "git write-tree" : "git rev-parse HEAD"} /></label>
            {structureError ? <p className="validation-message" role="alert">{structureError}</p> : null}
            <button className="primary-button" type="button" onClick={recordManualStructure}>Save manual structure confirmation</button>
          </div>
        </>
      )}
      <div className="command-context">
        <StatusPill tone="neutral">{platform === "windows" ? "Windows + WSL" : "POSIX"}</StatusPill>
        <span>Build: {platform === "windows" ? "PowerShell" : "Linux / macOS shell"}</span>
        <span>VM tests: {platform === "windows" ? "Ubuntu 24.04 WSL" : "native Linux"}</span>
      </div>
      <CommandPair firstTitle="Build contract + data-driver WASM" first={commands.build} secondTitle="Run the VM test" second={commands.test} />
      <div className="focus-card wide">
        <h2>Record the two built artifacts</h2>
        <p>Run these read-only inspection commands, then enter only basenames, hashes, byte sizes, and the same source identity recorded above. Absolute paths and terminal output are rejected.</p>
        <CommandPair firstTitle="Locate WASM files and byte sizes" first={artifactCommands.locate} secondTitle="Calculate WASM SHA-256 values" second={artifactCommands.hash} />
        <ArtifactEvidenceForm value={artifactInput} onChange={changeArtifactInput} />
        {artifactError ? <p className="validation-message" role="alert">{artifactError}</p> : null}
        <button className="primary-button" type="button" disabled={!structureReady} onClick={recordArtifacts}>Save manual artifact evidence</button>
        {!structureReady ? <p className="quiet-note">Save the starter or existing-project structure first.</p> : null}
      </div>
      <div className="focus-card wide">
        <h2>Record the VM test separately</h2>
        <p>A successful build does not prove the VM test passed. Confirm only after <code>dusk-forge test</code> exits successfully in the reviewed Linux lane.</p>
        {platform === "windows" ? (
          <p className="quiet-note">The reviewed Windows lane is Ubuntu 24.04 under WSL; native Windows is not presented as verified.</p>
        ) : (
          <p className="quiet-note">The reviewed POSIX VM-test lane is native Linux. macOS users should run the test inside a Linux VM or container; a native macOS pass is not recorded as validated evidence.</p>
        )}
        <button className="evidence-toggle" type="button" aria-pressed={testsPassed} onClick={() => {
          if (buildProgress.evidence.includes("duskds-vm-test-attestation")) journey.invalidate("duskds", "build");
          setTestsPassed((value) => !value);
        }}>
          {testsPassed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
          I observed the VM test pass in this environment
        </button>
        <button className="primary-button" type="button" disabled={!structureReady || !testsPassed || !validateRevision(artifactInput.revision || structureRevision).value} onClick={recordTests}>
          Save manual VM-test evidence
        </button>
      </div>
    </StepFrame>
  );
}

function ArtifactEvidenceForm({
  value,
  onChange
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
}) {
  const field = (name: keyof typeof value, next: string) => onChange({ ...value, [name]: next });
  return (
    <div className="artifact-form">
      <label>Artifact source identity<input value={value.revision} onChange={(event) => field("revision", event.target.value)} placeholder="7–64 hexadecimal characters" /></label>
      <fieldset>
        <legend>Contract WASM</legend>
        <label>Filename<input value={value.contractName} onChange={(event) => field("contractName", event.target.value)} placeholder="counter_contract.wasm" /></label>
        <label>SHA-256<input value={value.contractSha256} onChange={(event) => field("contractSha256", event.target.value)} placeholder="64 hexadecimal characters" /></label>
        <label>Size in bytes<input inputMode="numeric" value={value.contractSize} onChange={(event) => field("contractSize", event.target.value)} /></label>
      </fieldset>
      <fieldset>
        <legend>Data-driver WASM</legend>
        <label>Filename<input value={value.dataDriverName} onChange={(event) => field("dataDriverName", event.target.value)} placeholder="counter_data_driver.wasm" /></label>
        <label>SHA-256<input value={value.dataDriverSha256} onChange={(event) => field("dataDriverSha256", event.target.value)} placeholder="64 hexadecimal characters" /></label>
        <label>Size in bytes<input inputMode="numeric" value={value.dataDriverSize} onChange={(event) => field("dataDriverSize", event.target.value)} /></label>
      </fieldset>
    </div>
  );
}

function FileEvidence({ files }: { files: string[] }) {
  return (
    <div className="file-evidence">
      <div><strong>{files.length} relative filenames returned</strong></div>
      <ul>{files.slice(0, 12).map((file) => <li key={file}><code>{file}</code></li>)}</ul>
      <small>File contents and absolute local paths are not returned to the browser.</small>
    </div>
  );
}

function DuskDsInspect({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const inspectProgress = journey.progress.paths.duskds.inspect;
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
  const [blockState, setBlockState] = useState<AsyncState>(restoredBlockObservation ? "success" : "idle");
  const [blockMessage, setBlockMessage] = useState(
    restoredBlockObservation
      ? `Saved observation: latest block ${restoredBlockObservation.height} at ${new Date(restoredBlockObservation.observedAt).toLocaleString()}.`
      : "Latest-block inspection has not run."
  );
  const [observation, setObservation] = useState<DuskDsBlockObservation | null>(restoredBlockObservation);
  const [revision, setRevision] = useState(savedRevision);
  const [revisionError, setRevisionError] = useState("");
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
  const manualInspectEvidence = (code: string) => inspectProgress.evidenceEntries
    .some((entry) => entry.code === code && entry.method === "manual");
  const normalizedDriverContractId = driverInput.contractId.trim().replace(/^0x/i, "").toLowerCase();
  const normalizedInspectRevision = revision.trim().toLowerCase();
  const driverRoutesAvailable = Boolean(
    savedAvailability
      && savedAvailability.metadata?.contractId === normalizedDriverContractId
      && savedAvailability.metadata.revision === normalizedInspectRevision
  );
  const metadataReadCommands = {
    posix: [
      `curl -sS -X POST "${DUSKDS_TESTNET_NODE}/on/contract:<contract_id>/metadata" --output metadata-response.bin`,
      "cat metadata-response.bin",
      "shasum -a 256 metadata-response.bin"
    ].join("\n"),
    windows: [
      `Invoke-WebRequest -Method Post -Uri '${DUSKDS_TESTNET_NODE}/on/contract:<contract_id>/metadata' -OutFile 'metadata-response.bin'`,
      "Get-Content -Raw -LiteralPath '.\\metadata-response.bin'",
      "(Get-FileHash -Algorithm SHA256 -LiteralPath '.\\metadata-response.bin').Hash"
    ].join("\r\n")
  };
  const driverReadCommands = {
    posix: [
      `curl -sS -X POST "${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/get_schema" --output schema-response.bin`,
      `curl -sS -X POST "${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/encode_input_fn:<fn_name>" --data-raw '<json_input>' --output encode-response.bin`,
      `curl -sS -X POST "${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/decode_output_fn:<fn_name>" --data-raw '0x<encoded_output>' --output decode-response.bin`,
      "cat schema-response.bin",
      "cat encode-response.bin",
      "cat decode-response.bin",
      "shasum -a 256 schema-response.bin encode-response.bin decode-response.bin"
    ].join("\n"),
    windows: [
      `Invoke-WebRequest -Method Post -Uri '${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/get_schema' -OutFile 'schema-response.bin'`,
      `Invoke-WebRequest -Method Post -Uri '${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/encode_input_fn:<fn_name>' -Body '<json_input>' -OutFile 'encode-response.bin'`,
      `Invoke-WebRequest -Method Post -Uri '${DUSKDS_TESTNET_NODE}/on/driver:<contract_id>/decode_output_fn:<fn_name>' -Body '0x<encoded_output>' -OutFile 'decode-response.bin'`,
      "Get-Content -Raw -LiteralPath '.\\schema-response.bin'",
      "Get-Content -Raw -LiteralPath '.\\encode-response.bin'",
      "Get-Content -Raw -LiteralPath '.\\decode-response.bin'",
      "Get-FileHash -Algorithm SHA256 -LiteralPath '.\\schema-response.bin', '.\\encode-response.bin', '.\\decode-response.bin'"
    ].join("\r\n")
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
      journey.block("duskds", "inspect", "rpc-unavailable");
    }
  }

  function recordManualBlock() {
    const result = validateBlockObservation(blockHeight, blockHash);
    if (!result.value) {
      setBlockError(result.error ?? "Enter the observed block result.");
      return;
    }
    setBlockError("");
    journey.record("duskds", "inspect", ["duskds-inspect-latest-block"], {
      method: "manual",
      metadata: result.value
    });
  }

  function changeInspectBlockHeight(next: string) {
    if (next !== blockHeight && manualInspectEvidence("duskds-inspect-latest-block")) {
      journey.removeEvidence("duskds", "inspect", ["duskds-inspect-latest-block"]);
    }
    setBlockHeight(next);
  }

  function changeInspectBlockHash(next: string) {
    if (next !== blockHash && manualInspectEvidence("duskds-inspect-latest-block")) {
      journey.removeEvidence("duskds", "inspect", ["duskds-inspect-latest-block"]);
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
    }
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
      }
    }
    setDriverInput((current) => ({ ...current, [key]: next }));
  }

  function setDriverError(kind: keyof typeof driverChecks, message: string) {
    setDriverErrors((current) => ({ ...current, [kind]: message }));
  }

  function recordRevision() {
    const result = validateRevision(revision);
    if (!result.value) {
      setRevisionError(result.error ?? "Enter the source identity.");
      return;
    }
    const buildRevision = getDuskDsBuildSourceRevision(journey.progress);
    if (!buildRevision) {
      setRevisionError("Return to Build and record matching artifact and VM-test source identities first.");
      return;
    }
    if (result.value !== buildRevision) {
      setRevisionError("Use the same source identity recorded for both Build artifacts and the VM test.");
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
    const checkedRevision = validateRevision(revision);
    if (!checkedRevision.value) {
      setDriverError(kind, "Record the source identity first so every driver observation is tied to the same build.");
      return;
    }
    const recordedRevision = journey.progress.paths.duskds.inspect.evidenceEntries
      .find((entry) => entry.code === "duskds-inspect-artifact-revision")
      ?.metadata?.revision;
    if (!recordedRevision || recordedRevision !== checkedRevision.value) {
      setDriverError(kind, "Save this exact source identity before recording driver observations.");
      return;
    }
    if (!driverChecks[kind]) {
      setDriverError(kind, `Confirm the ${kind} result you observed before saving it.`);
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
        setDriverError(kind, "First confirm that this contract's metadata reports driver_available: true.");
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
      setDriverError(kind, observation.error ?? `Enter the bounded ${kind} observation.`);
      return;
    }
    setDriverError(kind, "");
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

  function driverCheckRow(kind: keyof typeof driverChecks) {
    const disabled = kind !== "availability" && !driverRoutesAvailable;
    const digest = driverInput[driverDigestKey[kind]];
    const errorId = `duskds-${kind}-observation-error`;
    return (
      <div className="inspection-check" key={kind}>
        <button
          className="evidence-toggle"
          type="button"
          aria-pressed={driverChecks[kind]}
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
            value={digest}
            disabled={disabled}
            aria-invalid={Boolean(driverErrors[kind]) || undefined}
            aria-describedby={driverErrors[kind] ? errorId : undefined}
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
      <div className="focus-card wide">
        <h2>1. Observe a latest block</h2>
        <p>Choose a direct hosted read or enter the bounded height and hash you observed yourself. This is independent from the artifact and data-driver checks.</p>
        <CompletionMethodPicker value={blockMethod} onChange={setBlockMethod} automaticAvailable automaticLabel="Hosted safe check" />
        {blockMethod === "automatic" ? (
          <>
            <button className="primary-button" type="button" disabled={blockState === "loading"} onClick={runLatestBlockRead}>Read latest block</button>
            {blockState === "idle"
              ? <p className="quiet-note">{blockMessage}</p>
              : <AsyncNotice state={blockState} message={blockMessage} onRetry={blockState === "error" || blockState === "timeout" || blockState === "unavailable" ? runLatestBlockRead : undefined} />}
            {observation ? <BlockReceipt observation={observation} label="Automatic browser observation" /> : null}
          </>
        ) : (
          <>
            <div className="evidence-form">
              <label>Block height<input inputMode="numeric" value={blockHeight} onChange={(event) => changeInspectBlockHeight(event.target.value)} /></label>
              <label>Block hash<input value={blockHash} onChange={(event) => changeInspectBlockHash(event.target.value)} placeholder="64 hexadecimal characters" /></label>
            </div>
            {blockError ? <p className="validation-message" role="alert">{blockError}</p> : null}
            <button className="primary-button" type="button" onClick={recordManualBlock}>Save manual block observation</button>
          </>
        )}
      </div>
      <div className="focus-card wide" id="duskds-source-identity" tabIndex={-1}>
        <h2>2. Bind inspection to the built source</h2>
        <p>Use the same Git tree or commit ID recorded during Build. New Studio starters use <code>git write-tree</code>; existing repositories use <code>git rev-parse HEAD</code>. This prevents post-deploy observations from being attributed to a different build.</p>
        <label>Artifact source identity<input value={revision} onChange={(event) => changeInspectRevision(event.target.value)} placeholder="7–64 hexadecimal characters" /></label>
        {revisionError ? <p className="validation-message" role="alert">{revisionError}</p> : null}
        <button className="primary-button" type="button" onClick={recordRevision}>Save source match</button>
      </div>
      <DuskDsDeployReadiness setRoute={setRoute} />
      <div className="focus-card wide" id="duskds-post-deploy-inspection" tabIndex={-1}>
        <h2>4. Return after deployment and inspect the data driver</h2>
        <p>Use the contract ID only after confirming deployment inclusion and finality outside Studio. First read <code>/on/contract:&lt;contract_id&gt;/metadata</code> and confirm <code>driver_available: true</code>. Deployment alone does not publish a data driver; if that value is false, stop here and use the recovery guidance instead of calling driver routes.</p>
        <button className="secondary-button" type="button" onClick={openDataDriverRecovery}>Open data-driver recovery</button>
        <CommandPair
          firstTitle="Fetch, inspect + hash metadata on Linux / macOS"
          first={metadataReadCommands.posix}
          secondTitle="Fetch, inspect + hash metadata on Windows"
          second={metadataReadCommands.windows}
        />
        <p>Inspect the saved response locally before hashing it. Confirm that metadata explicitly reports <code>driver_available: true</code>, then record only its SHA-256 in Studio. Never paste the response body or terminal output here.</p>
        <div className="evidence-form">
          <label>
            Deployed contract ID
            <input value={driverInput.contractId} onChange={(event) => changeDriverIdentity("contractId", event.target.value)} placeholder="64 hexadecimal characters" />
          </label>
          <label>
            Function name for encode / decode
            <input value={driverInput.functionName} onChange={(event) => changeDriverIdentity("functionName", event.target.value)} placeholder="increment_by" />
          </label>
        </div>
        <p className="quiet-note">Never paste a secret, seed phrase, signing request, private endpoint, credential, raw response, or payload into these fields. Studio stores only the checked result, source identity, contract ID, function name, endpoint origin, and response digest.</p>
        {driverCheckRow("availability")}
        {driverRoutesAvailable ? (
          <>
            <AsyncNotice state="success" message="This contract's saved metadata evidence reports driver_available: true. Driver read commands are now available." />
            <CommandPair
              firstTitle="Fetch, inspect + hash driver responses on Linux / macOS"
              first={driverReadCommands.posix}
              secondTitle="Fetch, inspect + hash driver responses on Windows"
              second={driverReadCommands.windows}
            />
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
