import { getDefaultDuskEvmNetwork } from "@dusk/core";
import sourceFreshness from "../../../../data/dusk/source-freshness.json";
import { STUDIO_RELEASE } from "../release";
import type { BuilderPath, EvidenceCode } from "./journeyProgress";
import { getStudioRuntime } from "./runtime";
import type { StepInfo } from "./types";

export const localAgentUrl = import.meta.env.VITE_LOCAL_AGENT_URL || "http://127.0.0.1:8788";
export const localStudioUrl = "http://127.0.0.1:5173";
export const defaultNetwork = getDefaultDuskEvmNetwork();
export const studioRuntime = getStudioRuntime(window.location.hostname, STUDIO_RELEASE.channel);
export const initialCommandPlatform = /Win/i.test(window.navigator.platform) ? "windows" as const : "posix" as const;
export const sourceDate = new Date(sourceFreshness.reviewed_at + "T00:00:00.000Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const expiryDate = new Date(sourceFreshness.expires_at + "T00:00:00.000Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const sourceIsStale = Date.now() > Date.parse(sourceFreshness.expires_at + "T23:59:59.999Z");

export const pathText = {
  evm: {
    label: "DuskEVM",
    eyebrow: "Solidity path",
    availability: "Pre-launch preview",
    availabilityTone: "warn",
    availabilityCopy: "Browse the educational workflow now. Live Testnet evidence remains deferred until the network launches.",
    summary: "Choose this to learn the planned Solidity, Foundry or Hardhat, EVM wallet, DUSK gas, Blockscout, and optional Hedger research flow.",
    start: "Start Solidity path",
    result: "A source-backed map of the DuskEVM workflow; live RPC, wallet, and inspection proof waits for Testnet launch."
  },
  duskds: {
    label: "DuskDS",
    eyebrow: "Native Dusk path",
    availability: "Active guide",
    availabilityTone: "good",
    availabilityCopy: "Public docs and read-only node guidance are available now. Local machine actions require the portable companion.",
    summary: "Choose this for Rust/WASM contracts, DuskVM, data drivers, W3sper, Dusk Connect, or privacy-aware native flows.",
    start: "Start native path",
    result: "A source-backed DuskDS route to a Forge starter, contract/data-driver build evidence, and a recorded native read."
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
    { id: "setup", number: "1", label: "Setup", title: "Prove the native Dusk toolchain is ready.", intent: "Classify required tool failures without exposing environment values or local paths.", done: ["Required tools pass.", "Rust 1.94, WASM target, and rust-src are present.", "Windows VM-test requirements are explicit."] },
    { id: "access", number: "2", label: "Access", title: "Prove a read-only Dusk node query works.", intent: "Run the W3sper query locally, check its expected shape, then record the observed outcome.", done: ["Latest block header is returned.", "Profile and endpoint context are understood.", "No key or transaction is required."] },
    { id: "build", number: "3", label: "Build", title: "Build contract and data-driver WASM together.", intent: "Verify scaffold structure, build both outputs, and separately record the VM-test result.", done: ["Forge structure is verified.", "Both WASM artifacts are observed.", "VM tests pass in the stated environment."] },
    { id: "inspect", number: "4", label: "Inspect", title: "Confirm native finality and data-driver compatibility.", intent: "Record the read-only network and schema checks you actually observed; deployment stays manual.", done: ["Recent state is queryable.", "Data-driver schema and encode/decode behavior are checked.", "No unobserved on-chain claim is made."] }
  ]
} satisfies Record<BuilderPath, StepInfo[]>;

export const resourceIds = { evm: ["build-on-dusk", "duskevm-deep-dive", "duskevm-bridge", "deploy-on-duskevm", "blockscout-verification"], duskds: ["build-on-dusk", "duskds-smart-contracts", "dusk-forge", "w3sper-integration", "dusk-connect-docs", "duskds-tx-lifecycle"] } satisfies Record<BuilderPath, string[]>;
export const capabilityIds = { evm: ["duskevm-solidity-contracts", "duskevm-wallets-network", "duskevm-testnet-bridge", "duskevm-confidential-hedger"], duskds: ["duskds-forge-contracts", "duskds-data-drivers", "duskds-w3sper-node-sdk", "dusk-connect-wallets"] } satisfies Record<BuilderPath, string[]>;
export const troubleIds = { evm: ["wrong-chain", "no-wallet", "insufficient-gas", "rpc-unavailable", "foundry-missing", "verification-failed"], duskds: ["dusk-forge-windows-wasm-opt-shim", "dusk-forge-windows-long-path-linker", "rust-wasm-target-missing", "dusk-forge-rust-stable-drift", "data-driver-build-missing", "dusk-forge-test-linux-required"] } satisfies Record<BuilderPath, string[]>;

export const evidenceLabels: Record<EvidenceCode, string> = {
  "evm-rpc-chain": "Future gate: Testnet RPC chain verified", "evm-wallet-chain": "Future gate: wallet chain verified", "evm-wallet-account": "Future gate: selected account observed", "evm-balance-read": "Future gate: read-only balance succeeded", "evm-positive-balance": "Future gate: positive Testnet balance observed", "evm-starter-structure": "Future gate: Counter scaffold verified", "evm-build-test-attestation": "Future gate: build and tests passed", "evm-read-inspection": "Future gate: read-only RPC inspection passed",
  "duskds-required-preflight": "All required native tools passed", "duskds-node-read-attestation": "W3sper node read recorded as successful", "duskds-starter-structure": "Forge scaffold structure verified", "duskds-build-artifact-attestation": "Both WASM outputs recorded as observed", "duskds-vm-test-attestation": "VM tests recorded as passed", "duskds-read-inspection-attestation": "Native state and data-driver checks recorded"
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
