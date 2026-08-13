import { getDefaultDuskEvmNetwork, isDuskEvmNetworkReviewCurrent } from "@dusk/core/browser-catalog";
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
export function isEvmActivationCurrent(now = Date.now()): boolean {
  return now <= Date.parse(sourceFreshness.expires_at + "T23:59:59.999Z")
    && isDuskEvmNetworkReviewCurrent(defaultNetwork, now);
}

export const pathText = {
  evm: {
    label: "DuskEVM",
    eyebrow: "Solidity Testnet",
    availability: "Testnet active",
    availabilityTone: "good",
    availabilityCopy: "Run bounded read-only network checks in the hosted guide. Wallet prompts stay separate and optional; builds and signing stay on your machine.",
    summary: "Use Solidity with Foundry or Hardhat, an EIP-1193 wallet you control, DUSK Testnet gas, and the Testnet explorer.",
    start: "Start DuskEVM",
    result: "Verified Testnet identity and progression before any wallet, funding, build, or deploy decision."
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
    { id: "setup", number: "1", label: "Setup", title: "Verify DuskEVM Testnet before touching a wallet.", intent: "Check the allowlisted public RPC twice, confirm chain 745, and prove the head is progressing.", done: ["RPC chain ID is 745 / 0x2e9.", "A later block is observed.", "No wallet or signature is requested."] },
    { id: "access", number: "2", label: "Access", title: "Connect and fund a wallet without giving Studio signing power.", intent: "Discover, connect, switch, and read balance as separate wallet requests; use the official bridge only when you choose to move Testnet DUSK.", done: ["The wallet reports chain 745.", "One selected account is observed in memory only.", "A positive DUSK Testnet balance is read without signing."] },
    { id: "build", number: "3", label: "Build", title: "Compile and test a fresh Solidity starter locally.", intent: "Use the reviewed Foundry or Hardhat starter, capture artifact identity, and keep private keys out of commands and files.", done: ["Starter structure is verified.", "Compile and tests pass locally.", "Signing remains in a keystore, hardware wallet, or wallet UI you control."] },
    { id: "inspect", number: "4", label: "Inspect", title: "Inspect Testnet state and preserve deployment evidence.", intent: "Read an address, transaction, or block through the bounded RPC adapter and open only the allowlisted Testnet explorer.", done: ["Identifier shape is validated locally.", "RPC result and failure state are explicit.", "Deployment and verification remain manual signer-owned handoffs."] }
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
export const troubleIds = { evm: ["wrong-chain", "no-wallet", "insufficient-gas", "rpc-unavailable", "foundry-missing", "verification-failed"], duskds: ["duskds-existing-repository-read-only", "duskds-node-npm-runtime", "duskds-public-node-unavailable", "duskds-browser-public-node-csp", "dusk-forge-windows-wasm-opt-shim", "dusk-forge-windows-long-path-linker", "rust-wasm-target-missing", "dusk-forge-rust-stable-drift", "data-driver-build-missing", "dusk-forge-test-linux-required", "duskds-driver-unavailable-after-deploy"] } satisfies Record<BuilderPath, string[]>;
export const evidenceLabels: Record<EvidenceCode, string> = {
  "evm-rpc-chain": "Testnet RPC chain 745 verified", "evm-rpc-progression": "Testnet head progression verified", "evm-wallet-chain": "Wallet chain 745 verified", "evm-wallet-account": "Selected account observed in memory", "evm-balance-read": "Read-only DUSK balance succeeded", "evm-positive-balance": "Positive Testnet gas balance observed", "evm-starter-structure": "Reviewed Counter starter verified", "evm-build-test-attestation": "Local compile and tests recorded", "evm-read-inspection": "Read-only RPC inspection passed",
  "duskds-required-preflight": "Required native tool checks recorded", "duskds-node-read-attestation": "Dusk node read result recorded", "duskds-starter-structure": "Forge scaffold structure recorded", "duskds-build-artifact-attestation": "Both WASM outputs recorded as observed", "duskds-vm-test-attestation": "VM test result recorded", "duskds-inspect-latest-block": "Latest block header observed", "duskds-inspect-artifact-revision": "Contract and data-driver source identity matched", "duskds-inspect-driver-availability": "Contract metadata confirms a data driver", "duskds-inspect-driver-schema": "Data-driver schema response confirmed", "duskds-inspect-driver-encode": "Data-driver input encoding confirmed", "duskds-inspect-driver-decode": "Data-driver output decoding confirmed", "duskds-read-inspection-attestation": "Legacy native inspection confirmation"
};

export const blockerLabels: Record<BlockerCode, string> = {
  "rpc-unavailable": "The public node request could not be completed",
  "wrong-network-identity": "The RPC genesis does not match the reviewed Testnet",
  "duskds-public-node-unavailable": "The DuskDS public node request could not be completed",
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
