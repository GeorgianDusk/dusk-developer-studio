import {
  CheckCircle2,
  XCircle
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  addOrSwitchNetwork,
  buildDuskDsCommandSet,
  checkRpcHealth,
  classifyEvmIdentifier,
  getInjectedProvider,
  getWalletAccounts,
  getWalletBalance,
  getWalletChainId,
  inspectEvmIdentifier,
  normalizeWalletError,
  parseHexBlockNumber,
  quotePosixArg,
  type CommandPlatform,
  type EvmReadResult,
  type RpcHealthResult
} from "@dusk/core";
import { isPreflightResult, isScaffoldEvidence, type PreflightResult } from "../responseSchemas";
import { requestJson, SafeRequestError, safeRequestMessage } from "../safeRequest";
import { CompanionActionButton, StepFrame } from "../StudioShell";
import { AsyncNotice, CommandPair, CopyButton, ExternalLink, MiniSteps, StatusPill, type AsyncState } from "../StudioUi";
import { defaultNetwork, initialCommandPlatform, joinPath, sourceDate } from "../studioConfig";
import { useJourney, useStudioRuntime } from "../studioState";
import type { CompanionStatus, RouteId, Tone } from "../types";
import type { BuilderPath } from "../journeyProgress";

function stateForError(error: unknown): AsyncState {
  if (error instanceof SafeRequestError) {
    if (error.kind === "timeout") return "timeout";
    if (error.kind === "unavailable") return "unavailable";
  }
  return "error";
}

export function SetupPage({ builderPath, companionStatus, setRoute }: { builderPath: BuilderPath; companionStatus: CompanionStatus; setRoute: (route: RouteId) => void }) {
  return builderPath === "evm" ? <EvmSetup setRoute={setRoute} /> : <DuskDsSetup companionStatus={companionStatus} setRoute={setRoute} />;
}

function EvmSetup({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const [rpcResult, setRpcResult] = useState<RpcHealthResult | null>(null);
  const [rpcBusy, setRpcBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState("Wallet not checked yet.");
  const network = defaultNetwork;
  async function runRpcCheck() {
    journey.invalidate("evm", "setup");
    setRpcResult(null);
    setRpcBusy(true);
    const result = await checkRpcHealth(network);
    setRpcResult(result);
    setRpcBusy(false);
    if (result.status === "healthy") journey.record("evm", "setup", ["evm-rpc-chain"]);
    else journey.block("evm", "setup", result.status === "wrong-chain" ? "wrong-chain" : "rpc-unavailable");
  }
  async function connectNetwork() {
    journey.invalidate("evm", "setup");
    const provider = getInjectedProvider();
    if (!provider) { setWalletMessage("No EVM wallet was detected in this browser."); journey.block("evm", "setup", "no-wallet"); return; }
    try {
      await addOrSwitchNetwork(provider, network);
      const chainId = await getWalletChainId(provider);
      if (chainId !== network.chainIdHex.toLowerCase()) { setWalletMessage("Wallet is on " + chainId + "; expected " + network.chainIdHex + "."); journey.block("evm", "setup", "wrong-chain"); return; }
      const accounts = await getWalletAccounts(provider, true);
      if (!accounts[0]) { setWalletMessage("Wallet is on Testnet, but no account was selected."); journey.block("evm", "setup", "no-account"); return; }
      const balance = await getWalletBalance(provider, accounts[0]);
      setWalletMessage(`Testnet account ${accounts[0].slice(0, 6)}…${accounts[0].slice(-4)} selected; read-only balance ${balance.formatted} DUSK.`);
      journey.record("evm", "setup", ["evm-wallet-chain", "evm-wallet-account", "evm-balance-read"]);
    } catch (error) { setWalletMessage(normalizeWalletError(error).message); journey.block("evm", "setup", "no-account"); }
  }
  return <StepFrame builderPath="evm" route="setup" setRoute={setRoute} helper={<ExternalLink href={network.sourceUrl}>{network.sourceLabel}</ExternalLink>}><div className="action-stack"><div className="focus-card"><span className="section-kicker">Testnet action</span><h2>Check the DuskEVM Testnet RPC</h2><p>The check reads chain ID and latest block. Mainnet and Devnet remain read-only references.</p><div className="network-lock"><StatusPill tone="good">Testnet</StatusPill><strong>{network.name}</strong><small>Chain {network.chainId} / {network.chainIdHex}</small></div><div className="button-row"><button className="primary-button" type="button" onClick={runRpcCheck} disabled={rpcBusy}>{rpcBusy ? "Checking" : rpcResult?.retryable ? "Retry RPC check" : "Run RPC check"}</button><CopyButton value={network.rpcUrls[0]} label="Copy RPC URL" /></div>{rpcBusy ? <AsyncNotice state="loading" message="Reading chain ID and latest block from the allowlisted Testnet RPC." /> : rpcResult ? <RpcResultCard result={rpcResult} onRetry={rpcResult.retryable ? runRpcCheck : undefined} /> : <p className="quiet-note">Expected chain ID: {network.chainIdHex}. Explorer: {network.explorerUrl}</p>}</div><div className="focus-card secondary"><span className="section-kicker">Then</span><h2>Verify wallet, account, and balance</h2><p>This may request account access, then performs only chain and balance reads. Nothing is persisted.</p><button className="secondary-button" type="button" onClick={connectNetwork}>Verify Testnet wallet</button><div role="status" aria-live="polite" aria-atomic="true"><p className="quiet-note">{walletMessage}</p></div></div></div></StepFrame>;
}

function DuskDsSetup({ companionStatus, setRoute }: { companionStatus: CompanionStatus; setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const { companionBaseUrl } = useStudioRuntime();
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [message, setMessage] = useState("Native toolchain not checked yet.");
  const [state, setState] = useState<AsyncState>("idle");
  async function runPreflight() {
    journey.invalidate("duskds", "setup");
    setPreflight(null);
    setState("loading");
    setMessage("Running the bounded allowlisted preflight.");
    try {
      if (!companionBaseUrl) throw new Error("Local companion URL is unavailable.");
      const data = await requestJson(companionBaseUrl + "/preflight?path=duskds", { init: { credentials: "include" }, validate: isPreflightResult, maxBytes: 64 * 1024 });
      setPreflight(data);
      const optionalFailures = data.tools.some((tool) => !tool.required && !tool.ok);
      setState(data.ok ? optionalFailures ? "partial" : "success" : "error");
      setMessage(data.ok ? optionalFailures ? "Required tools are ready; one or more optional tools need attention." : "Required native tools are ready." : "Some required native tools need attention.");
      if (data.ok) journey.record("duskds", "setup", ["duskds-required-preflight"]);
      else journey.block("duskds", "setup", data.tools.some((tool) => tool.required && tool.failureKind === "unsupported") ? "unsupported-platform" : "toolchain-incomplete");
    } catch (error) {
      setState(stateForError(error));
      setMessage(safeRequestMessage(error));
      journey.block("duskds", "setup", "companion-unavailable");
    }
  }
  return <StepFrame builderPath="duskds" route="setup" setRoute={setRoute} helper={<ExternalLink href="https://github.com/dusk-network/forge">Open Dusk Forge</ExternalLink>}><div className="action-stack"><div className="focus-card"><span className="section-kicker">Do this first</span><h2>Run the bounded native preflight</h2><p>The companion checks an allowlist of tools. It returns bounded versions and failure categories—not environment variables, raw errors, or local paths.</p><CompanionActionButton companionStatus={companionStatus} setRoute={setRoute} onAction={runPreflight} disabled={state === "loading"}>Run native preflight</CompanionActionButton>{state !== "idle" ? <AsyncNotice state={state} message={message} onRetry={state === "error" || state === "timeout" || state === "unavailable" ? runPreflight : undefined} /> : <p className="quiet-note">{message}</p>}{preflight ? <PreflightPanel result={preflight} /> : null}</div><div className="focus-card secondary"><span className="section-kicker">Failure recovery</span><h2>Read the category first</h2><p>Missing, unsupported, timed out, version mismatch, and execution failure require different fixes. Optional tools never fail the entire preflight.</p></div></div></StepFrame>;
}

function RpcResultCard({ result, onRetry }: { result: RpcHealthResult; onRetry?: () => void | Promise<void> }) {
  const tone: Tone = result.status === "healthy" ? "good" : result.status === "wrong-chain" ? "danger" : "warn";
  const state: AsyncState = result.status === "healthy" ? "success" : result.status === "timeout" ? "timeout" : "error";
  return <div className="result-card"><AsyncNotice state={state} message={result.message} onRetry={onRetry} /><StatusPill tone={tone}>{result.status}</StatusPill><small>Latency {result.latencyMs}ms{result.httpStatus ? " · HTTP " + result.httpStatus : ""}{result.blockNumberHex ? " · block " + parseHexBlockNumber(result.blockNumberHex) : ""}</small><ExternalLink href={defaultNetwork.sourceUrl}>Official network source</ExternalLink></div>;
}

function PreflightPanel({ result }: { result: PreflightResult }) {
  return <div className="tool-list">{result.tools.map((tool) => <div key={tool.name} className={tool.ok ? "tool-row ok" : "tool-row fail"}>{tool.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<strong>{tool.name}</strong><span>{tool.ok ? tool.version ?? "ready" : `${tool.failureKind ?? "execution-failed"}: ${tool.installHint ?? tool.error ?? "needs attention"}`}</span></div>)}</div>;
}

export function AccessPage({ builderPath, setRoute }: { builderPath: BuilderPath; setRoute: (route: RouteId) => void }) {
  return builderPath === "evm" ? <EvmAccess setRoute={setRoute} /> : <DuskDsAccess setRoute={setRoute} />;
}

function EvmAccess({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const [message, setMessage] = useState("Balance not checked in this step yet.");
  async function checkBalance() {
    journey.invalidate("evm", "access");
    const provider = getInjectedProvider();
    if (!provider) { setMessage("No EVM wallet was detected."); journey.block("evm", "access", "no-wallet"); return; }
    try {
      const chainId = await getWalletChainId(provider);
      if (chainId !== defaultNetwork.chainIdHex.toLowerCase()) { setMessage(`Wrong chain ${chainId}; switch to ${defaultNetwork.chainIdHex}.`); journey.block("evm", "access", "wrong-chain"); return; }
      const accounts = await getWalletAccounts(provider);
      if (!accounts[0]) { setMessage("No selected account is available. Return to Setup."); journey.block("evm", "access", "no-account"); return; }
      const balance = await getWalletBalance(provider, accounts[0]);
      setMessage(`Read-only balance: ${balance.formatted} DUSK for ${accounts[0].slice(0, 6)}…${accounts[0].slice(-4)}.`);
      if (balance.wei > 0n) journey.record("evm", "access", ["evm-positive-balance"]); else journey.block("evm", "access", "insufficient-gas");
    } catch (error) { setMessage(normalizeWalletError(error).message); journey.block("evm", "access", "no-account"); }
  }
  return <StepFrame builderPath="evm" route="access" setRoute={setRoute} helper={<button type="button" onClick={() => setRoute("troubleshooting")}>Funding help</button>}><div className="focus-card wide"><span className="section-kicker">Read before bridge</span><h2>Check the selected Testnet balance</h2><p>The Studio reads only the current chain, account list, and balance. It never initiates a bridge, faucet, transfer, or signature.</p><button className="primary-button" type="button" onClick={checkBalance}>Check read-only Testnet balance</button><div role="status" aria-live="polite" aria-atomic="true"><p className="quiet-note">{message}</p></div></div><div className="focus-card wide"><span className="section-kicker">Official recovery route</span><h2>Use the bridge guide only if the balance is zero</h2><ExternalLink href="https://docs.dusk.network/learn/guides/duskevm-bridge/">Open DuskEVM bridge guide</ExternalLink></div><MiniSteps items={["Confirm DuskEVM Testnet in the wallet.", "Move only a small test amount through the official route.", "Return and repeat the read-only balance check."]} /></StepFrame>;
}

function DuskDsAccess({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const connectSnippet = ["import { Network } from '@dusk/w3sper';", "", "const network = await Network.connect('https://testnet.nodes.dusk.network');", "const tip = await network.query('block(height: -1) { header { height hash } }');", "console.log(tip.block.header);"].join("\n");
  return <StepFrame builderPath="duskds" route="access" setRoute={setRoute} helper={<ExternalLink href="https://docs.dusk.network/developer/integrations/w3sper/">W3sper docs</ExternalLink>}><div className="focus-card wide"><span className="section-kicker">Read-only local proof</span><h2>Query the latest block with W3sper</h2><p>Run this in your app. A successful result contains a block-header height and hash. The Studio cannot observe your terminal, so completion is an explicit attestation.</p><pre>{connectSnippet}</pre><div className="button-row"><CopyButton value={connectSnippet} label="Copy W3sper connection snippet" /><button className="primary-button" type="button" onClick={() => journey.record("duskds", "access", ["duskds-node-read-attestation"])}>Record observed height + hash</button></div></div><MiniSteps items={["Run the snippet locally.", "Confirm height and hash are present.", "Record success only after observing both fields."]} /></StepFrame>;
}

export function BuildPage({ builderPath, companionStatus, setRoute }: { builderPath: BuilderPath; companionStatus: CompanionStatus; setRoute: (route: RouteId) => void }) {
  return builderPath === "evm" ? <EvmBuild companionStatus={companionStatus} setRoute={setRoute} /> : <DuskDsBuild companionStatus={companionStatus} setRoute={setRoute} />;
}

function EvmBuild({ companionStatus, setRoute }: { companionStatus: CompanionStatus; setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const { companionBaseUrl } = useStudioRuntime();
  const [projectName, setProjectName] = useState("dusk-evm-starter");
  const [parentDir, setParentDir] = useState("");
  const [message, setMessage] = useState("Starter not created yet.");
  const [files, setFiles] = useState<string[]>([]);
  const [state, setState] = useState<AsyncState>("idle");
  const projectPath = joinPath(parentDir.trim() || ".generated", projectName);
  const buildCommands = ["cd " + quotePosixArg(projectPath), "forge build", "forge test"].join("\n");
  const deployCommands = ["cast wallet import dusk-testnet-deployer --interactive", "forge create src/Counter.sol:Counter --rpc-url dusk_evm_testnet --account dusk-testnet-deployer"].join("\n");
  async function scaffold() {
    journey.invalidate("evm", "build");
    setFiles([]);
    setState("loading");
    setMessage("Creating the bounded Counter starter.");
    try {
      if (!companionBaseUrl) throw new Error("Local companion URL is unavailable.");
      const data = await requestJson(companionBaseUrl + "/scaffold-template", { init: { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName, parentDir: parentDir.trim() || undefined }) }, validate: isScaffoldEvidence, maxBytes: 64 * 1024 });
      if (!data.ok || !data.structureVerified) throw new Error("Starter structure could not be verified.");
      setFiles(data.files);
      setState("success");
      setMessage("Counter source and test structure verified. Run the build and test commands next.");
      journey.record("evm", "build", ["evm-starter-structure"]);
    } catch (error) { setState(stateForError(error)); setMessage(safeRequestMessage(error)); journey.block("evm", "build", "companion-unavailable"); }
  }
  const structureReady = journey.progress.paths.evm.build.evidence.includes("evm-starter-structure");
  return <StepFrame builderPath="evm" route="build" setRoute={setRoute} helper={<ExternalLink href="https://docs.dusk.network/developer/smart-contracts-dusk-evm/deploy-on-evm/">Deploy docs</ExternalLink>}><ProjectForm projectName={projectName} setProjectName={setProjectName} parentDir={parentDir} setParentDir={setParentDir} placeholder="Defaults to .generated" onCreate={scaffold} companionStatus={companionStatus} setRoute={setRoute} action="Create and verify Counter starter" message={message} state={state} />{files.length ? <FileEvidence files={files} /> : null}<CommandPair firstTitle="Build and test" first={buildCommands} secondTitle="Manual deploy after tests" second={deployCommands} /><div className="focus-card wide"><span className="section-kicker">Manual result boundary</span><h2>Record the command outcome</h2><p>Click only after both <code>forge build</code> and <code>forge test</code> exit successfully. Deployment uses an encrypted local account and stays outside Studio automation.</p><button className="primary-button" type="button" disabled={!structureReady} onClick={() => journey.record("evm", "build", ["evm-build-test-attestation"])}>Record build + tests passed</button></div></StepFrame>;
}

function DuskDsBuild({ companionStatus, setRoute }: { companionStatus: CompanionStatus; setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const { companionBaseUrl } = useStudioRuntime();
  const [projectName, setProjectName] = useState("duskds-forge-starter");
  const [parentDir, setParentDir] = useState("");
  const [message, setMessage] = useState("Forge starter not created yet.");
  const [files, setFiles] = useState<string[]>([]);
  const [state, setState] = useState<AsyncState>("idle");
  const [commandPlatform, setCommandPlatform] = useState<CommandPlatform>(initialCommandPlatform);
  const commandSet = buildDuskDsCommandSet({ parentDir: parentDir.trim(), projectName, platform: commandPlatform });
  async function scaffoldForge() {
    journey.invalidate("duskds", "build");
    setFiles([]);
    setState("loading");
    setMessage("Creating the bounded Forge starter.");
    try {
      if (!companionBaseUrl) throw new Error("Local companion URL is unavailable.");
      const data = await requestJson(companionBaseUrl + "/scaffold-duskds-forge", { init: { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName, parentDir: parentDir.trim() || undefined }) }, validate: isScaffoldEvidence, maxBytes: 64 * 1024 });
      if (!data.ok || !data.structureVerified) throw new Error("Forge structure could not be verified.");
      if (data.platform) setCommandPlatform(data.platform);
      setFiles(data.files);
      setState("success");
      setMessage("Forge structure verified. Rust pin: " + (data.rustToolchain || "1.94.0") + ".");
      journey.record("duskds", "build", ["duskds-starter-structure"]);
    } catch (error) { setState(stateForError(error)); setMessage(safeRequestMessage(error)); journey.block("duskds", "build", "companion-unavailable"); }
  }
  const structureReady = journey.progress.paths.duskds.build.evidence.includes("duskds-starter-structure");
  return <StepFrame builderPath="duskds" route="build" setRoute={setRoute} helper={<ExternalLink href="https://github.com/dusk-network/forge">Dusk Forge</ExternalLink>}><ProjectForm projectName={projectName} setProjectName={setProjectName} parentDir={parentDir} setParentDir={setParentDir} placeholder={commandPlatform === "windows" ? "Relative to C:\\tmp\\dusk-studio-projects" : "Relative to .generated"} onCreate={scaffoldForge} companionStatus={companionStatus} setRoute={setRoute} action="Create and verify Forge starter" message={message} state={state} />{files.length ? <FileEvidence files={files} /> : null}<div className="command-context"><StatusPill tone="neutral">{commandPlatform}</StatusPill><span>Build: {commandPlatform === "windows" ? "PowerShell" : "POSIX shell"}</span><span>VM tests: {commandSet.testEnvironment}</span></div><CommandPair firstTitle="Build contract + data-driver WASM" first={commandSet.build} secondTitle={`Run VM tests (${commandSet.testEnvironment})`} second={commandSet.test} /><div className="focus-card wide"><span className="section-kicker">Two independent observations</span><h2>Record artifacts and tests separately</h2><p>Confirm both contract and data-driver WASM exist after the build. Then record VM tests only after the test command passes in the stated environment.</p><div className="button-row"><button className="primary-button" type="button" disabled={!structureReady} onClick={() => journey.record("duskds", "build", ["duskds-build-artifact-attestation"])}>Record both WASM outputs observed</button><button className="secondary-button" type="button" disabled={!structureReady} onClick={() => journey.record("duskds", "build", ["duskds-vm-test-attestation"])}>Record VM tests passed</button></div></div></StepFrame>;
}

function ProjectForm({ projectName, setProjectName, parentDir, setParentDir, placeholder, onCreate, companionStatus, setRoute, action, message, state }: { projectName: string; setProjectName: (value: string) => void; parentDir: string; setParentDir: (value: string) => void; placeholder: string; onCreate: () => void | Promise<void>; companionStatus: CompanionStatus; setRoute: (route: RouteId) => void; action: string; message: string; state: AsyncState }) {
  return <div className="focus-card wide"><span className="section-kicker">Create locally</span><h2>Create the starter locally</h2><div className="form-grid"><label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>Parent folder<input value={parentDir} onChange={(event) => setParentDir(event.target.value)} placeholder={placeholder} /></label></div><CompanionActionButton companionStatus={companionStatus} setRoute={setRoute} onAction={onCreate} disabled={state === "loading"}>{action}</CompanionActionButton>{state === "idle" ? <p className="quiet-note">{message}</p> : <AsyncNotice state={state} message={message} onRetry={state === "error" || state === "timeout" || state === "unavailable" ? onCreate : undefined} />}</div>;
}

function FileEvidence({ files }: { files: string[] }) {
  return <div className="file-evidence"><div><span className="section-kicker">Observed structure</span><strong>{files.length} relative filenames</strong></div><ul>{files.slice(0, 12).map((file) => <li key={file}><code>{file}</code></li>)}</ul><small>File contents and absolute local paths are not returned to the browser.</small></div>;
}

export function InspectPage({ builderPath, setRoute }: { builderPath: BuilderPath; setRoute: (route: RouteId) => void }) {
  return builderPath === "evm" ? <EvmInspect setRoute={setRoute} /> : <DuskDsInspect setRoute={setRoute} />;
}

function EvmInspect({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EvmReadResult | null>(null);
  const classification = useMemo(() => classifyEvmIdentifier(input), [input]);
  const invalidInput = input.trim().length > 0 && !classification;
  async function inspect() {
    journey.invalidate("evm", "inspect");
    const identifier = classifyEvmIdentifier(input);
    if (!identifier) { setResult(null); journey.block("evm", "inspect", "invalid-identifier"); return; }
    setResult(null);
    setBusy(true);
    const next = await inspectEvmIdentifier(defaultNetwork, identifier);
    setResult(next);
    setBusy(false);
    if (next.ok) journey.record("evm", "inspect", ["evm-read-inspection"]); else journey.block("evm", "inspect", next.failureKind === "not-found" ? "result-not-found" : "rpc-unavailable");
  }
  return <StepFrame builderPath="evm" route="inspect" setRoute={setRoute} helper={<ExternalLink href={defaultNetwork.explorerUrl}>Open Blockscout</ExternalLink>}><div className="focus-card wide"><span className="section-kicker">One read-only input</span><h2>Inspect an address, transaction hash, or block</h2><label>Testnet identifier<input value={input} onChange={(event) => setInput(event.target.value)} placeholder="0x address, 0x transaction hash, or block number" aria-invalid={invalidInput || undefined} aria-describedby="evm-identifier-help evm-identifier-validation" /></label><p className="quiet-note" id="evm-identifier-help">Use a 40-hex-character address, a 64-hex-character transaction hash, or a decimal or hexadecimal block number.</p><p className={invalidInput ? "validation-message" : "sr-only"} id="evm-identifier-validation" role="status" aria-live="polite" aria-atomic="true">{invalidInput ? "Identifier not recognized. Check the required address, transaction hash, or block number format." : ""}</p><div className="button-row"><StatusPill tone={classification ? "good" : invalidInput ? "danger" : "neutral"}>{classification?.type ?? (invalidInput ? "invalid" : "waiting")}</StatusPill><button className="primary-button" type="button" onClick={inspect} disabled={!classification || busy}>{busy ? "Inspecting" : "Inspect read-only"}</button></div>{busy ? <AsyncNotice state="loading" message="Reading this identifier from the allowlisted Testnet RPC." /> : result ? <div className="inspection-result"><AsyncNotice state={result.ok ? "success" : result.failureKind === "timeout" ? "timeout" : result.failureKind === "not-found" ? "empty" : "error"} message={result.summary} onRetry={!result.ok ? inspect : undefined} />{result.details.map((detail) => <p key={detail}>{detail}</p>)}<div className="provenance-line"><em>Testnet RPC</em><em>checked {new Date(result.checkedAt).toLocaleString()}</em><em>source reviewed {sourceDate}</em></div><div className="button-row"><ExternalLink href={result.explorerUrl}>Open in Blockscout</ExternalLink><ExternalLink href={result.sourceUrl}>Official source</ExternalLink></div></div> : null}</div></StepFrame>;
}

function DuskDsInspect({ setRoute }: { setRoute: (route: RouteId) => void }) {
  const journey = useJourney();
  const querySnippet = ["const tip = await network.query(\"block(height: -1) { header { height hash } }\");", "console.log(tip.block.header);"].join("\n");
  const driverSnippet = ["GET /rues/contract/{contract_id}/data-driver/schema", "POST /rues/contract/{contract_id}/data-driver/call"].join("\n");
  return <StepFrame builderPath="duskds" route="inspect" setRoute={setRoute} helper={<button type="button" onClick={() => setRoute("reference")}>Open native references</button>}><div className="focus-card wide"><span className="section-kicker">Manual observation boundary</span><h2>Confirm state finality and data-driver fit</h2><p>Run both read-only checks. Record completion only after a recent block header is returned and the data driver produces the schema/call behavior your frontend expects.</p><MiniSteps items={["Query a recent finalized header.", "Check contract and data-driver artifacts come from the same commit.", "Exercise schema/call reads without deploying or signing."]} /><button className="primary-button" type="button" onClick={() => journey.record("duskds", "inspect", ["duskds-read-inspection-attestation"])}>Record both native read checks observed</button></div><CommandPair firstTitle="Query latest block" first={querySnippet} secondTitle="Data-driver endpoints" second={driverSnippet} /></StepFrame>;
}
