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
  evm: { label: "DuskEVM", eyebrow: "Solidity path", summary: "Choose this for Solidity, Foundry or Hardhat, EVM wallets, DUSK gas, Blockscout, and optional Hedger research.", start: "Start Solidity path", result: "A tested DuskEVM starter plus a read-only receipt, address, or block result." },
  duskds: { label: "DuskDS", eyebrow: "Native Dusk path", summary: "Choose this for Rust/WASM contracts, DuskVM, data drivers, W3sper, Dusk Connect, or privacy-aware native flows.", start: "Start native path", result: "A Forge starter with contract/data-driver build evidence and a recorded native read result." }
} satisfies Record<BuilderPath, { label: string; eyebrow: string; summary: string; start: string; result: string }>;

export const steps = {
  evm: [
    { id: "setup", number: "1", label: "Setup", title: "Prove your RPC, wallet network, account, and balance read.", intent: "Confirm DuskEVM Testnet without signing or storing wallet details.", done: ["RPC returns the expected Testnet chain.", "Wallet reports the expected chain and a selected account.", "A read-only balance request succeeds."] },
    { id: "access", number: "2", label: "Access", title: "Confirm testnet DUSK is available for gas.", intent: "Use a read-only wallet balance and the official bridge guide; the Studio never moves funds.", done: ["Wallet remains on DuskEVM Testnet.", "The selected account has a positive testnet balance."] },
    { id: "build", number: "3", label: "Build", title: "Create, build, and test the Counter starter.", intent: "Verify generated structure locally, run the displayed commands, and record the result honestly.", done: ["Counter source and test files exist.", "Foundry build and tests pass.", "Deploy signing remains manual through an encrypted account."] },
    { id: "inspect", number: "4", label: "Inspect", title: "Read an address, transaction, or block from Testnet.", intent: "Classify the identifier locally, query only the allowlisted RPC, and link to Blockscout.", done: ["Identifier type is known.", "A read-only RPC result is shown with provenance.", "No signing request was made."] }
  ],
  duskds: [
    { id: "setup", number: "1", label: "Setup", title: "Prove the native Dusk toolchain is ready.", intent: "Classify required tool failures without exposing environment values or local paths.", done: ["Required tools pass.", "Rust 1.94, WASM target, and rust-src are present.", "Windows VM-test requirements are explicit."] },
    { id: "access", number: "2", label: "Access", title: "Prove a read-only Dusk node query works.", intent: "Run the W3sper query locally, check its expected shape, then record the observed outcome.", done: ["Latest block header is returned.", "Profile and endpoint context are understood.", "No key or transaction is required."] },
    { id: "build", number: "3", label: "Build", title: "Build contract and data-driver WASM together.", intent: "Verify scaffold structure, build both outputs, and separately record the VM-test result.", done: ["Forge structure is verified.", "Both WASM artifacts are observed.", "VM tests pass in the stated environment."] },
    { id: "inspect", number: "4", label: "Inspect", title: "Confirm native finality and data-driver compatibility.", intent: "Record the read-only network and schema checks you actually observed; deployment stays manual.", done: ["Recent state is queryable.", "Data-driver schema/call behavior is checked.", "No unobserved on-chain claim is made."] }
  ]
} satisfies Record<BuilderPath, StepInfo[]>;

export const resourceIds = { evm: ["build-on-dusk", "duskevm-deep-dive", "duskevm-bridge", "deploy-on-duskevm", "blockscout-verification"], duskds: ["build-on-dusk", "duskds-smart-contracts", "dusk-forge", "w3sper-integration", "dusk-connect-docs", "duskds-tx-lifecycle"] } satisfies Record<BuilderPath, string[]>;
export const capabilityIds = { evm: ["duskevm-solidity-contracts", "duskevm-wallets-network", "duskevm-testnet-bridge", "duskevm-confidential-hedger"], duskds: ["duskds-forge-contracts", "duskds-data-drivers", "duskds-w3sper-node-sdk", "dusk-connect-wallets"] } satisfies Record<BuilderPath, string[]>;
export const troubleIds = { evm: ["wrong-chain", "no-wallet", "insufficient-gas", "rpc-unavailable", "foundry-missing", "verification-failed"], duskds: ["dusk-forge-windows-wasm-opt-shim", "dusk-forge-windows-long-path-linker", "rust-wasm-target-missing", "dusk-forge-rust-stable-drift", "data-driver-build-missing", "dusk-forge-test-linux-required"] } satisfies Record<BuilderPath, string[]>;

export const evidenceLabels: Record<EvidenceCode, string> = {
  "evm-rpc-chain": "Testnet RPC chain verified", "evm-wallet-chain": "Wallet chain verified", "evm-wallet-account": "Selected account observed", "evm-balance-read": "Read-only balance succeeded", "evm-positive-balance": "Positive testnet balance observed", "evm-starter-structure": "Counter scaffold structure verified", "evm-build-test-attestation": "Build and tests recorded as passed", "evm-read-inspection": "Read-only RPC inspection returned a result",
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
