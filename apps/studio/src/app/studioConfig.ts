import { getDefaultDuskEvmNetwork } from "@dusk/core/browser-catalog";
import sourceFreshness from "../../../../data/dusk/source-freshness.json";
import { STUDIO_RELEASE } from "../release";
import type { BlockerCode, BuilderPath, EvidenceCode } from "./journeyProgress";
import { getStudioRuntime } from "./runtime";
import type { StepInfo } from "./types";

export const localAgentUrl = import.meta.env.VITE_LOCAL_AGENT_URL || "http://127.0.0.1:8788";
export const localStudioUrl = "http://127.0.0.1:5173";
export const defaultNetwork = getDefaultDuskEvmNetwork();
export const studioRuntime = getStudioRuntime(window.location.hostname, STUDIO_RELEASE.channel);
export const initialCommandPlatform = /Win/i.test(window.navigator.platform) ? "windows" as const : "posix" as const;
export const initialManualPlatform = /Win/i.test(window.navigator.platform)
  ? "windows" as const
  : /Mac/i.test(window.navigator.platform)
    ? "macos" as const
    : "linux" as const;
export const sourceDate = new Date(sourceFreshness.reviewed_at + "T00:00:00.000Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const expiryDate = new Date(sourceFreshness.expires_at + "T00:00:00.000Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const sourceIsStale = Date.now() > Date.parse(sourceFreshness.expires_at + "T23:59:59.999Z");

export const pathText = {
  evm: {
    label: "DuskEVM",
    eyebrow: "Solidity pre-launch",
    availability: "Reference only",
    availabilityTone: "warn",
    availabilityCopy: "Explore one source-backed pre-launch reference. It does not provide a completion score, wallet flow, starter, funding action, or deployment task.",
    summary: "Review the planned Solidity, Foundry or Hardhat, EVM wallet, DUSK gas, Blockscout, and optional Hedger direction before the live developer journey is activated.",
    start: "Explore pre-launch reference",
    result: "A clear map of the planned DuskEVM workflow and the conditions that must be met before live developer actions are enabled."
  },
  duskds: {
    label: "DuskDS",
    eyebrow: "Native Dusk path",
    availability: "Guide and local tools available",
    availabilityTone: "good",
    availabilityCopy: "Follow every step manually, or run the Local Studio with npm for tool checks and starter creation.",
    summary: "Choose this for Rust/WASM contracts, DuskVM, data drivers, W3sper, Dusk Connect, or privacy-aware native flows.",
    start: "Start DuskDS",
    result: "A source-backed route through prerequisites, a read-only node query, a local Forge build, and clearly labeled results."
  }
} satisfies Record<BuilderPath, {
  label: string;
  eyebrow: string;
  availability: string;
  availabilityTone: "good" | "warn";
  availabilityCopy: string;
  summary: string;
  start: string;
  result: string;
}>;

export const steps = {
  evm: [
    { id: "setup", number: "1", label: "Setup", title: "Understand the planned RPC and wallet checks.", intent: "Use only the explicit pre-launch endpoint probe; wallet, account, and balance actions remain disabled.", done: ["Pre-launch status is understood.", "No wallet prompt is enabled.", "Live evidence remains deferred."] },
    { id: "access", number: "2", label: "Access", title: "Review how Testnet access and gas will work.", intent: "Learn the future read-only balance and official bridge flow without connecting a wallet or moving funds.", done: ["The future access sequence is understood.", "No wallet or balance request is enabled.", "No funds are moved."] },
    { id: "build", number: "3", label: "Build", title: "Review the planned local Foundry workflow.", intent: "Learn the starter, build, test, and signing boundaries without creating files or showing a deploy command.", done: ["The planned local workflow is understood.", "No companion scaffold is enabled.", "No deployment command is exposed."] },
    { id: "inspect", number: "4", label: "Inspect", title: "Learn the supported Testnet identifier shapes.", intent: "Classify an example locally while network inspection remains disabled until reviewed activation.", done: ["Identifier formats are understood.", "Classification stays local.", "No RPC or signing request is made."] }
  ],
  duskds: [
    { id: "setup", number: "1", label: "Setup", title: "Record the native toolchain checks you ran.", intent: "Classify required tool failures without exposing environment values or local paths.", done: ["Required tool checks are recorded.", "Rust 1.94, WASM target, and rust-src are present.", "Windows VM-test requirements are explicit."] },
    { id: "access", number: "2", label: "Access", title: "Check a read-only Dusk node query.", intent: "Run the W3sper query locally, check its expected shape, then record the observed outcome.", done: ["Latest block header is returned.", "Profile and endpoint context are understood.", "No key or transaction is required."] },
    { id: "build", number: "3", label: "Build", title: "Build contract and data-driver WASM together.", intent: "Verify scaffold structure, build both outputs, and separately record the VM-test result.", done: ["Forge structure is verified.", "Both WASM artifacts are observed.", "VM tests pass in the stated environment."] },
    { id: "inspect", number: "4", label: "Inspect", title: "Prepare the manual deploy and verify post-deploy reads.", intent: "Bind the build to one source identity, review the manual Rusk Wallet handoff, then return with a contract ID for read-only checks.", done: ["Pre-deploy evidence is reviewed.", "Signing and deployment stay outside Studio.", "Post-deploy schema and encode/decode behavior are checked separately."] }
  ]
} satisfies Record<BuilderPath, StepInfo[]>;

export const resourceIds = { evm: ["build-on-dusk", "duskevm-deep-dive", "duskevm-bridge", "deploy-on-duskevm", "blockscout-verification"], duskds: ["build-on-dusk", "duskds-smart-contracts", "dusk-forge", "w3sper-integration", "dusk-connect-docs", "duskds-tx-lifecycle", "studio-local-security-boundary", "windows-wsl-ubuntu-setup"] } satisfies Record<BuilderPath, string[]>;
export const capabilityIds = { evm: ["duskevm-solidity-contracts", "duskevm-wallets-network", "duskevm-testnet-bridge", "duskevm-confidential-hedger"], duskds: ["duskds-forge-contracts", "duskds-data-drivers", "duskds-w3sper-node-sdk", "dusk-connect-wallets"] } satisfies Record<BuilderPath, string[]>;
export const troubleIds = { evm: ["wrong-chain", "no-wallet", "insufficient-gas", "rpc-unavailable", "foundry-missing", "verification-failed"], duskds: ["duskds-browser-public-node-csp", "dusk-forge-windows-wasm-opt-shim", "dusk-forge-windows-long-path-linker", "rust-wasm-target-missing", "dusk-forge-rust-stable-drift", "data-driver-build-missing", "dusk-forge-test-linux-required", "duskds-driver-unavailable-after-deploy"] } satisfies Record<BuilderPath, string[]>;

export const evidenceLabels: Record<EvidenceCode, string> = {
  "evm-rpc-chain": "Future gate: Testnet RPC chain verified", "evm-wallet-chain": "Future gate: wallet chain verified", "evm-wallet-account": "Future gate: selected account observed", "evm-balance-read": "Future gate: read-only balance succeeded", "evm-positive-balance": "Future gate: positive Testnet balance observed", "evm-starter-structure": "Future gate: Counter scaffold verified", "evm-build-test-attestation": "Future gate: build and tests passed", "evm-read-inspection": "Future gate: read-only RPC inspection passed",
  "duskds-required-preflight": "Required native tool checks recorded", "duskds-node-read-attestation": "Dusk node read result recorded", "duskds-starter-structure": "Forge scaffold structure recorded", "duskds-build-artifact-attestation": "Both WASM outputs recorded as observed", "duskds-vm-test-attestation": "VM test result recorded", "duskds-inspect-latest-block": "Latest block header observed", "duskds-inspect-artifact-revision": "Contract and data-driver source identity matched", "duskds-inspect-driver-availability": "Contract metadata confirms a data driver", "duskds-inspect-driver-schema": "Data-driver schema response confirmed", "duskds-inspect-driver-encode": "Data-driver input encoding confirmed", "duskds-inspect-driver-decode": "Data-driver output decoding confirmed", "duskds-read-inspection-attestation": "Legacy native inspection confirmation"
};

export const blockerLabels: Record<BlockerCode, string> = {
  "rpc-unavailable": "The public node request could not be completed",
  "wrong-chain": "The selected wallet network does not match",
  "no-wallet": "No compatible wallet was found",
  "no-account": "No wallet account was selected",
  "insufficient-gas": "The selected account does not have enough gas",
  "companion-unavailable": "Local Studio is not connected",
  "toolchain-incomplete": "One or more required tool checks are incomplete",
  "unsupported-platform": "This platform is not in the reviewed execution lane",
  "invalid-identifier": "The identifier format is not supported",
  "result-not-found": "The requested result was not found",
  "local-build-unverified": "The local build result has not been recorded",
  "user-deferred": "This step was skipped for now"
};

export function joinPath(parent: string, child: string): string {
  const cleanParent = parent.replace(/[\\/]+$/, "");
  return cleanParent + (cleanParent.includes("\\") ? "\\" : "/") + child;
}

export function pickById<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}

export { sourceFreshness };
