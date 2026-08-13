import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { isCurrentEvmScaffoldRequest, restoredManualAccessToolIds } from "../app/routes/GuideRoutes";
import { createInitialJourneyProgress, JOURNEY_PROGRESS_STORAGE_KEY, recordJourneyEvidence, skipJourneyStep } from "../app/journeyProgress";
import { DUSK_STUDIO_NPM_PACKAGE_VERSION } from "../app/manualJourneyConfig";

function progressThroughDuskDsAccess() {
  let progress = recordJourneyEvidence(
    createInitialJourneyProgress(),
    "duskds",
    "setup",
    ["duskds-required-preflight"],
    { method: "manual" }
  );
  progress = recordJourneyEvidence(
    progress,
    "duskds",
    "access",
    ["duskds-node-read-attestation"],
    {
      method: "manual",
      metadata: {
        blockHeight: 1,
        blockHash: "f".repeat(64)
      }
    }
  );
  return progress;
}

function progressThroughDuskDsBuild(revision: string) {
  return recordJourneyEvidence(
    progressThroughDuskDsAccess(),
    "duskds",
    "build",
    ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
    { method: "manual", metadata: { revision } }
  );
}

function currentEvmSetupProgress() {
  return recordJourneyEvidence(
    createInitialJourneyProgress(),
    "evm",
    "setup",
    ["evm-rpc-chain", "evm-rpc-progression"],
    {
      method: "automatic",
      observedAt: new Date().toISOString(),
      metadata: {
        source: "browser-check",
        tool: "rpc",
        platform: "browser",
        checkCount: 2,
        blockHeight: 1,
        blockHash: "0xb460e5846cdb8a442e0a3e227d4b43db4209170282ce36efc7c7d9dec8e383f7",
        endpoint: "https://rpc.testnet.evm.dusk.network"
      }
    }
  );
}

function seedCurrentEvmSetup() {
  window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(currentEvmSetupProgress()));
}

function seedEvmStepReady(route: "build" | "inspect") {
  let progress = currentEvmSetupProgress();
  progress = skipJourneyStep(progress, "evm", "access", "user-deferred");
  if (route === "inspect") progress = skipJourneyStep(progress, "evm", "build", "user-deferred");
  window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

function evmRpcResponse(result: unknown): Response {
  const value = new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  Object.defineProperty(value, "url", { value: "https://rpc.testnet.evm.dusk.network/" });
  return value;
}

describe("Phase 2 evidence journeys", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = "";
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "ethereum", { value: undefined, configurable: true, writable: true });
  });

  it("keeps Setup read-only and does not touch an injected wallet", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    const provider = {
      request: vi.fn()
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    expect(screen.getByRole("heading", { name: "Verify DuskEVM Testnet before touching a wallet." })).toBeInTheDocument();
    expect(screen.getByText("Studio-activated Testnet")).toBeInTheDocument();
    expect(screen.getByText("https://rpc.testnet.evm.dusk.network")).toBeVisible();
    expect(screen.getByText(/Setup never discovers, connects, switches, or signs with a wallet/i)).toBeInTheDocument();
    expect(screen.getAllByText("Not checked").length).toBeGreaterThan(0);
    expect(provider.request).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-wallet-account");
  });

  it("records Setup only after chain, genesis, and a later head all match", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    let blockRead = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      const result = request.method === "eth_chainId"
        ? "0x2e9"
        : request.method === "eth_getBlockByNumber"
          ? { hash: "0xb460e5846cdb8a442e0a3e227d4b43db4209170282ce36efc7c7d9dec8e383f7" }
          : blockRead++ === 0 ? "0x10" : "0x11";
      return evmRpcResponse(result);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Verify chain and progression" }));
    await waitFor(
      () => expect(screen.getByText(/progression from block 16 to 17/i)).toBeInTheDocument(),
      { timeout: 5_000 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { method: string; params: unknown[] });
    expect(requests.filter((request) => request.method === "eth_getBlockByNumber"))
      .toMatchObject([
        { method: "eth_getBlockByNumber", params: ["0x0", false] },
        { method: "eth_getBlockByNumber", params: ["0x0", false] }
      ]);
    await waitFor(() => {
      const stored = window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "";
      expect(stored).toContain("evm-rpc-progression");
      expect(stored).toContain("b460e5846cdb8a442e0a3e227d4b43db4209170282ce36efc7c7d9dec8e383f7");
      expect(stored).not.toContain("evm-wallet");
    });
  });

  it("withholds Setup evidence when chain 745 does not progress", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      const result = request.method === "eth_chainId"
        ? "0x2e9"
        : request.method === "eth_getBlockByNumber"
          ? { hash: "0xb460e5846cdb8a442e0a3e227d4b43db4209170282ce36efc7c7d9dec8e383f7" }
          : "0x10";
      return evmRpcResponse(result);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Verify chain and progression" }));
    await waitFor(
      () => expect(screen.getByText(/head did not progress beyond block 16/i)).toBeInTheDocument(),
      { timeout: 5_000 }
    );
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-rpc-progression");
  });

  it("separates discovery, connection, network change, and balance reads without requesting signing", async () => {
    seedCurrentEvmSetup();
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#access";
    const account = `0x${"a".repeat(40)}`;
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x2e9";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        throw new Error(`Unexpected method ${method}`);
      }),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
      removeListener: vi.fn((event: string) => listeners.delete(event))
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "1. Check existing session" }));
    await waitFor(() => expect(screen.getByText(/Observed an existing wallet session/i)).toBeInTheDocument());
    expect(provider.request.mock.calls.map(([request]) => request.method).sort()).toEqual(["eth_accounts", "eth_chainId"]);

    provider.request.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "2. Connect wallet" }));
    await waitFor(() => expect(screen.getByText(/account access was granted/i)).toBeInTheDocument());
    expect(provider.request.mock.calls.map(([request]) => request.method)).toEqual(["eth_requestAccounts"]);

    provider.request.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "3. Add or switch Testnet" }));
    await waitFor(() => expect(screen.getByText(/Wallet reports Testnet chain/i)).toBeInTheDocument());
    expect(provider.request.mock.calls.map(([request]) => request.method)).toEqual(["wallet_switchEthereumChain", "eth_chainId"]);

    provider.request.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "4. Read DUSK balance" }));
    await waitFor(() => expect(screen.getByText(/positive DUSK Testnet gas balance/i)).toBeInTheDocument());
    expect(provider.request.mock.calls.map(([request]) => request.method)).toEqual(["eth_chainId", "eth_getBalance"]);

    const everyMethod = provider.request.mock.calls.map(([request]) => request.method).join(" ");
    expect(everyMethod).not.toMatch(/sign|sendTransaction|personal|typedData/i);
    await waitFor(() => {
      const stored = window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "";
      expect(stored).toContain("evm-positive-balance");
      expect(stored).not.toContain(account);
      expect(stored).not.toContain("1.000000");
    });

    await waitFor(() => expect(listeners.has("chainChanged")).toBe(true));
    act(() => listeners.get("chainChanged")?.("0x1"));
    await waitFor(() => expect(screen.getByText(/Prior Access evidence was cleared/i)).toBeInTheDocument());
    await waitFor(() => expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-wallet-account"));
  });

  it("invalidates mounted Setup evidence when its fifteen-minute live-read window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
    seedCurrentEvmSetup();
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#access";
    render(<App />);
    const discover = screen.getByRole("button", { name: "1. Check existing session" });
    expect(discover).toBeEnabled();

    act(() => vi.advanceTimersByTime(15 * 60 * 1_000 + 1_000));
    expect(discover).toBeDisabled();
    expect(screen.getByText(/Complete the non-skippable Setup identity and progression check/i)).toBeInTheDocument();
  });

  it("discards a wallet result that resolves after Setup evidence expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
    seedCurrentEvmSetup();
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#access";
    let resolveAccounts!: (accounts: string[]) => void;
    const accountRequest = new Promise<string[]>((resolve) => { resolveAccounts = resolve; });
    const provider = { request: vi.fn(() => accountRequest) };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "2. Connect wallet" }));
    expect(screen.getByText(/Waiting for the wallet connection decision/i)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15 * 60 * 1_000 + 1_000));
    await act(async () => { resolveAccounts([`0x${"a".repeat(40)}`]); });

    expect(screen.getByText(/identity proof expired/i)).toBeInTheDocument();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-wallet-account");
  });

  it("binds build confirmations and accessible selection state to one toolchain", () => {
    seedEvmStepReady("build");
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#build";
    render(<App />);

    const foundry = screen.getByRole("button", { name: "Foundry" });
    const hardhat = screen.getByRole("button", { name: "Hardhat" });
    const structure = screen.getByRole("checkbox", { name: /verified the reviewed starter structure/i });
    const tests = screen.getByRole("checkbox", { name: /ran the shown compile and tests successfully/i });
    const save = screen.getByRole("button", { name: "Save local build confirmation" });
    expect(foundry).toHaveAttribute("aria-pressed", "true");
    expect(hardhat).toHaveAttribute("aria-pressed", "false");
    expect(structure.closest("label")).toHaveClass("inline-check");
    fireEvent.click(structure);
    fireEvent.click(tests);
    expect(save).toBeEnabled();

    fireEvent.click(hardhat);
    expect(foundry).toHaveAttribute("aria-pressed", "false");
    expect(hardhat).toHaveAttribute("aria-pressed", "true");
    expect(structure).not.toBeChecked();
    expect(tests).not.toBeChecked();
    expect(save).toBeDisabled();
  });

  it("rejects a deferred scaffold response after its toolchain generation changes", () => {
    expect(isCurrentEvmScaffoldRequest(1, 1, "foundry", "foundry")).toBe(true);
    expect(isCurrentEvmScaffoldRequest(1, 2, "foundry", "hardhat")).toBe(false);
    expect(isCurrentEvmScaffoldRequest(1, 1, "foundry", "hardhat")).toBe(false);
  });

  it("records a pending transaction observation without presenting it as green success", async () => {
    seedEvmStepReady("inspect");
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    const transactionHash = `0x${"b".repeat(64)}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(evmRpcResponse(null))
      .mockResolvedValueOnce(evmRpcResponse({ hash: transactionHash, blockNumber: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: /Address, transaction hash, or block/i }), { target: { value: transactionHash } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect on Testnet" }));
    const pending = await screen.findByText(/transaction is pending and has no receipt yet/i);
    expect(pending.closest(".async-notice")).toHaveClass("partial");
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").toContain("evm-read-inspection");
  });

  it("records a reverted receipt observation while presenting a danger state", async () => {
    seedEvmStepReady("inspect");
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    const transactionHash = `0x${"b".repeat(64)}`;
    vi.stubGlobal("fetch", vi.fn(async () => evmRpcResponse({
      transactionHash,
      status: "0x0",
      blockNumber: "0x10",
      contractAddress: null
    })));
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: /Address, transaction hash, or block/i }), { target: { value: transactionHash } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect on Testnet" }));
    const reverted = await screen.findByText(/transaction was included and reverted/i);
    expect(reverted.closest(".async-notice")).toHaveClass("error");
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").toContain("evm-read-inspection");
  });

  it("adds Testnet only after an explicit unknown-chain switch failure", async () => {
    seedCurrentEvmSetup();
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#access";
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("unknown chain"), { code: 4902 });
        if (method === "wallet_addEthereumChain") return null;
        if (method === "eth_chainId") return "0x2e9";
        throw new Error(`Unexpected method ${method}`);
      })
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "3. Add or switch Testnet" }));
    await waitFor(() => expect(screen.getByText(/Wallet reports Testnet chain/i)).toBeInTheDocument());
    expect(provider.request.mock.calls.map(([request]) => request.method)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId"
    ]);
    expect((provider.request.mock.calls[1][0] as unknown as { params: Array<Record<string, unknown>> }).params[0]).toMatchObject({
      chainId: "0x2e9",
      rpcUrls: ["https://rpc.testnet.evm.dusk.network"],
      blockExplorerUrls: ["https://explorer.testnet.evm.dusk.network"]
    });
  });

  it("surfaces a rejected wallet request without recording account evidence", async () => {
    seedCurrentEvmSetup();
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#access";
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") throw Object.assign(new Error("rejected"), { code: 4001 });
        throw new Error(`Unexpected method ${method}`);
      })
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "2. Connect wallet" }));
    await waitFor(() => expect(screen.getByText(/rejected. Nothing was signed or submitted/i)).toBeInTheDocument());
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-wallet-account");
  });

  it("classifies an EVM identifier locally until Inspect is explicitly chosen", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    const address = `0x${"b".repeat(40)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Address, transaction hash, or block"), { target: { value: address } });
    expect(screen.getByText("address")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Address, transaction hash, or block"), { target: { value: "12345" } });
    expect(screen.getByText("block")).toBeInTheDocument();
    expect(screen.getByText(/unsigned decimal block number such as 12345/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-read-inspection");
  });

  it("exposes invalid Inspect input through the field description", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    render(<App />);

    const input = screen.getByLabelText("Address, transaction hash, or block");
    fireEvent.change(input, { target: { value: "not-an-identifier" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Unrecognized shape/);
    fireEvent.change(input, { target: { value: "0x01" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/canonical unsigned JSON-RPC quantity/);
  });

  it("requires bounded manual values before recording a terminal observation", async () => {
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "setup",
      ["duskds-required-preflight"],
      { method: "automatic" }
    );
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Deno as checked" }));
    fireEvent.change(screen.getByLabelText("Block height"), { target: { value: "3820996" } });
    fireEvent.change(screen.getByLabelText("Block hash"), { target: { value: "a".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual node observation" }));
    await waitFor(() => expect(screen.getByText("Confirmed manually", { selector: ".done-panel .status-pill" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/DuskDS Access confirmed manually/)).toBeInTheDocument());
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)).toContain("duskds-node-read-attestation");
  });

  it("restores only the exact required Access tool confirmation saved by the UI", async () => {
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "setup",
      ["duskds-required-preflight"],
      { method: "automatic" }
    );
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    const view = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Deno as checked" }));
    fireEvent.change(screen.getByLabelText("Block height"), { target: { value: "3820996" } });
    fireEvent.change(screen.getByLabelText("Block hash"), { target: { value: "a".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual node observation" }));
    await waitFor(() => expect(screen.getByText("Confirmed manually", { selector: ".done-panel .status-pill" })).toBeInTheDocument());
    const saved = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
    expect(saved.paths.duskds.access.evidenceEntries[0].metadata).toMatchObject({
      source: "manual-confirmation",
      platform: "windows",
      tool: "deno",
      checkCount: 1
    });

    view.unmount();
    render(<App />);

    expect(screen.getByRole("button", { name: "Windows PowerShell" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Unmark Deno as checked" })).toBeInTheDocument();
    expect(screen.getByLabelText("Block height")).toHaveValue("3820996");
    expect(screen.getByLabelText("Block hash")).toHaveValue("a".repeat(64));
    expect(screen.getByRole("button", { name: "Save manual node observation" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Unmark Deno as checked" }));
    expect(screen.getByRole("button", { name: "Save manual node observation" })).toBeDisabled();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.access.evidence).toEqual([]);
    });
  });

  it("does not infer Access tool confirmation from incomplete or future-contract evidence", () => {
    const incomplete = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "access",
      ["duskds-node-read-attestation"],
      { method: "manual" }
    ).paths.duskds.access.evidenceEntries[0];
    expect(restoredManualAccessToolIds(incomplete, ["deno"])).toEqual([]);

    const legacyComplete = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "access",
      ["duskds-node-read-attestation"],
      {
        method: "manual",
        metadata: { platform: "windows", blockHeight: 3820996, blockHash: "b".repeat(64) }
      }
    ).paths.duskds.access.evidenceEntries[0];
    expect(restoredManualAccessToolIds(legacyComplete, ["deno"])).toEqual(["deno"]);
    expect(restoredManualAccessToolIds(legacyComplete, ["deno", "future-required-tool"])).toEqual([]);
    expect(restoredManualAccessToolIds({
      ...legacyComplete,
      metadata: { ...legacyComplete.metadata, source: "companion", tool: "deno", checkCount: 1 }
    }, ["deno"])).toEqual([]);
  });

  it("identifies and focuses the invalid manual Access field", async () => {
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "setup",
      ["duskds-required-preflight"],
      { method: "automatic" }
    );
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Deno as checked" }));
    fireEvent.change(screen.getByLabelText("Block height"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("Block hash"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual node observation" }));

    const height = screen.getByLabelText("Block height");
    expect(height).toHaveAttribute("aria-invalid", "true");
    expect(height).toHaveAccessibleDescription(/non-negative block height/);
    await waitFor(() => expect(height).toHaveFocus());
  });

  it("identifies and focuses the first invalid Build artifact field", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    fireEvent.click(screen.getByRole("button", { name: "Cargo.toml is present" }));
    fireEvent.click(screen.getByRole("button", { name: /rust-toolchain\.toml pins/ }));
    fireEvent.change(screen.getByLabelText("Source identity"), { target: { value: "a".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));
    const saveArtifacts = screen.getByRole("button", { name: "Save manual artifact evidence" });
    await waitFor(() => expect(saveArtifacts).toBeEnabled());
    fireEvent.click(saveArtifacts);

    const contractFilename = screen.getAllByLabelText("Filename")[0];
    await waitFor(() => expect(contractFilename).toHaveAttribute("aria-invalid", "true"));
    expect(contractFilename).toHaveAccessibleDescription(/Contract artifact must be a WASM basename/);
    await waitFor(() => expect(contractFilename).toHaveFocus());
  });

  it("associates and focuses invalid Inspect block and source fields", async () => {
    const buildRevision = "b".repeat(40);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsBuild(buildRevision)));
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save manual block observation" }));
    const height = screen.getByLabelText("Block height");
    expect(height).toHaveAttribute("aria-invalid", "true");
    expect(height).toHaveAccessibleDescription(/non-negative block height/);
    await waitFor(() => expect(height).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Save source match" }));
    const revision = screen.getByLabelText("Artifact source identity");
    expect(revision).toHaveAttribute("aria-invalid", "true");
    expect(revision).toHaveAccessibleDescription(/full 40- or 64-character Git tree or commit ID/);
    await waitFor(() => expect(revision).toHaveFocus());
  });

  it("requires a clean existing repository before binding its full commit identity", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Existing repository/ }));
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    fireEvent.change(screen.getByLabelText("Existing project root"), { target: { value: "/home/dev/existing-duskds" } });
    const sourceCommand = screen.getByRole("heading", { name: "Verify clean source + record full commit" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    expect(sourceCommand).toContain("git status --porcelain=v1 --untracked-files=all");
    expect(sourceCommand).toContain("git rev-parse --verify HEAD");
    expect(sourceCommand).toContain("tracked or untracked changes");

    fireEvent.click(screen.getByRole("button", { name: "Cargo.toml is present" }));
    fireEvent.click(screen.getByRole("button", { name: /rust-toolchain\.toml pins/ }));
    fireEvent.change(screen.getByLabelText("Source identity"), { target: { value: "a".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));

    const cleanConfirmation = screen.getByRole("button", { name: /Initial git status reported no tracked or untracked changes/ });
    expect(screen.getByRole("alert")).toHaveTextContent(/no tracked or untracked changes/);
    await waitFor(() => expect(cleanConfirmation).toHaveFocus());

    fireEvent.click(cleanConfirmation);
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.build.evidenceEntries.find(
        (entry) => entry.code === "duskds-starter-structure"
      )?.metadata).toMatchObject({ revision: "a".repeat(40), cleanTree: true, checkCount: 3 });
    });
  });

  it("requires a same-commit clean-tree recheck after existing-project build, test, and hashing", async () => {
    const revision = "a".repeat(40);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Existing repository/ }));
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    fireEvent.change(screen.getByLabelText("Existing project root"), { target: { value: "/home/dev/existing-duskds" } });
    fireEvent.click(screen.getByRole("button", { name: "Cargo.toml is present" }));
    fireEvent.click(screen.getByRole("button", { name: /rust-toolchain\.toml pins/ }));
    fireEvent.click(screen.getByRole("button", { name: /Initial git status reported no tracked or untracked changes/ }));
    fireEvent.change(screen.getByLabelText("Source identity"), { target: { value: revision } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));

    const finalCommand = screen.getByRole("heading", { name: "Revalidate the exact Git source before saving" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    expect(finalCommand).toContain(`expectedRevision='${revision}'`);
    expect(finalCommand).toContain("git status --porcelain=v1 --untracked-files=all");
    expect(finalCommand).toContain("git rev-parse --verify HEAD");
    expect(finalCommand).toContain("HEAD changed after the initial check");
    expect(screen.getByText(/ignored local files are not covered and must not influence the build/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: revision } });
    const names = screen.getAllByLabelText("Filename");
    const hashes = screen.getAllByLabelText("SHA-256");
    const sizes = screen.getAllByLabelText("Size in bytes");
    fireEvent.change(names[0], { target: { value: "counter-contract.wasm" } });
    fireEvent.change(hashes[0], { target: { value: "b".repeat(64) } });
    fireEvent.change(sizes[0], { target: { value: "1234" } });
    fireEvent.change(names[1], { target: { value: "counter-data-driver.wasm" } });
    fireEvent.change(hashes[1], { target: { value: "c".repeat(64) } });
    fireEvent.change(sizes[1], { target: { value: "2345" } });

    fireEvent.click(screen.getByRole("button", { name: "Save manual artifact evidence" }));
    const finalConfirmation = screen.getByRole("button", { name: /I ran the final Git source check/ });
    expect(screen.getByRole("alert")).toHaveTextContent(/final Git source check after building, testing, and hashing/);
    await waitFor(() => expect(finalConfirmation).toHaveFocus());

    fireEvent.click(finalConfirmation);
    fireEvent.click(screen.getByRole("button", { name: "Save manual artifact evidence" }));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.build.evidenceEntries.find(
        (entry) => entry.code === "duskds-build-artifact-attestation"
      )?.metadata).toMatchObject({
        revision,
        postBuildSourceCheck: true,
        sourceScope: "git-commit-plus-unignored-working-tree"
      });
    });
  });

  it("marks and focuses a Build revision that disagrees with its saved structure", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    fireEvent.click(screen.getByRole("button", { name: "Cargo.toml is present" }));
    fireEvent.click(screen.getByRole("button", { name: /rust-toolchain\.toml pins/ }));
    fireEvent.change(screen.getByLabelText("Source identity"), { target: { value: "a".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: "b".repeat(40) } });
    const names = screen.getAllByLabelText("Filename");
    const hashes = screen.getAllByLabelText("SHA-256");
    const sizes = screen.getAllByLabelText("Size in bytes");
    fireEvent.change(names[0], { target: { value: "counter-contract.wasm" } });
    fireEvent.change(hashes[0], { target: { value: "c".repeat(64) } });
    fireEvent.change(sizes[0], { target: { value: "1234" } });
    fireEvent.change(names[1], { target: { value: "counter-driver.wasm" } });
    fireEvent.change(hashes[1], { target: { value: "d".repeat(64) } });
    fireEvent.change(sizes[1], { target: { value: "2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual artifact evidence" }));

    const artifactRevision = screen.getByLabelText("Artifact source identity");
    expect(artifactRevision).toHaveAttribute("aria-invalid", "true");
    expect(artifactRevision).toHaveAccessibleDescription(/same source identity saved in the manual structure/);
    await waitFor(() => expect(artifactRevision).toHaveFocus());
  });

  it("keeps Access checks disabled until Setup has a truthful disposition", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    render(<App />);

    expect(screen.getByText("Complete or skip Setup first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run hosted safe check" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Deno as checked" }));
    expect(screen.getByRole("button", { name: "Save manual node observation" })).toBeDisabled();
    expect(screen.getByText("Complete or skip Setup before saving Access evidence.")).toBeInTheDocument();
  });

  it("keeps Build-dependent Inspect evidence disabled while leaving the independent block read available", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";
    const build = render(<App />);

    expect(screen.getByText("Complete or skip Access first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save manual structure confirmation" })).toBeDisabled();
    expect(screen.getByText("Complete or skip Access before saving Build evidence.")).toBeInTheDocument();

    build.unmount();
    window.location.hash = "#inspect";
    render(<App />);
    expect(screen.getByText("Build evidence is still incomplete")).toBeInTheDocument();
    expect(screen.getByText(/independent latest-block observation remains available/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read latest block" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    expect(screen.getByRole("button", { name: "Save manual block observation" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save source match" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save availability confirmation" })).toBeDisabled();
  });

  it("surfaces the conditional Ubuntu VM-test lane during Windows Setup", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#setup";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));

    expect(screen.getByText("WSL with Ubuntu 24.04")).toBeInTheDocument();
    expect(screen.getByText(/Setup also shows the Ubuntu 24.04 WSL check because Build's reviewed VM test runs there/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Conditional and optional tools/, { selector: "summary" }));
    const wslRow = screen.getByText("WSL with Ubuntu 24.04").closest("article");
    expect(wslRow).not.toBeNull();
    fireEvent.click(within(wslRow!).getByText("Commands and expected result"));
    expect(within(wslRow!).getByText((content, element) => element?.tagName === "PRE"
      && content.includes("wsl -d Ubuntu-24.04 -- true"))).toBeInTheDocument();
    expect(within(wslRow!).getByText((content, element) => element?.tagName === "PRE"
      && content.includes("dusk-forge-cli[[:space:]]+v?0\\.1\\.0.*d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a"))).toBeInTheDocument();
  });

  it("offers one copy action for all required Setup checks without hiding per-tool recovery", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#setup";
    render(<App />);

    expect(screen.getByRole("button", { name: "Copy all required Setup check commands" })).toBeInTheDocument();
    expect(screen.getAllByText("Commands and expected result")).toHaveLength(6);
  });

  it("gives every revealed tool-help link a descriptive accessible name", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#setup";
    render(<App />);

    const gitRow = screen.getByText("Git", { selector: "strong" }).closest("article");
    expect(gitRow).not.toBeNull();
    fireEvent.click(within(gitRow!).getByText("Commands and expected result"));
    expect(within(gitRow!).getByRole("link", { name: /Git installation and help/ })).toHaveAttribute(
      "href",
      "https://git-scm.com/downloads"
    );
  });

  it("gives the manual W3sper lane explicit folder and file creation steps", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));

    expect(screen.getByRole("heading", { name: "Create dedicated working folder" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create check-duskds.ts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paste this into check-duskds.ts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add W3sper" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run the read-only script" })).toBeInTheDocument();
  });

  it("uses the exact npm template creator, pins its reviewed WSL test, and opens contextual read-only recovery", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));

    expect(screen.getByText("Required before Prepare project")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Check the Node runtime used by npm" })).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === "PRE"
      && content.includes(`dusk-developer-studio@${DUSK_STUDIO_NPM_PACKAGE_VERSION} create-duskds`))).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === "PRE"
      && content.includes("Node.js >=24.18.0 <25 is required before starter creation.")
      && content.includes("npm.cmd --version")
      && content.includes(`dusk-developer-studio@${DUSK_STUDIO_NPM_PACKAGE_VERSION} create-duskds`))).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === "PRE"
      && content.includes("rustup run ''1.94.0'' \"$forgeExe\" test"))).toBeInTheDocument();
    expect(screen.getByText("wasm-opt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Existing repository/ }));
    fireEvent.change(screen.getByLabelText("Existing project root"), { target: { value: "C:\\work\\existing-duskds" } });
    expect(screen.getByText((content, element) => element?.tagName === "PRE"
      && content.includes("cd ''/mnt/c/work/existing-duskds''; rustup run ''1.94.0'' \"$forgeExe\" test"))).toBeInTheDocument();
    const sourceRevision = screen.getByRole("heading", { name: "Verify clean source + record full commit" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    expect(sourceRevision).toContain("git status --porcelain=v1 --untracked-files=all");
    expect(sourceRevision).toContain("git rev-parse --verify HEAD");
    expect(sourceRevision).toContain("tracked or untracked changes");
    const prepareExisting = screen.getByRole("heading", { name: "Prepare project (rechecks clean source first)" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    expect(prepareExisting.indexOf("git status --porcelain=v1 --untracked-files=all"))
      .toBeLessThan(prepareExisting.indexOf("rustup override set"));
    expect(screen.getByText("Writable checkout required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open read-only repository recovery" }));

    expect(window.location.hash).toBe("#duskds/troubleshooting");
    const recoveryHeading = await screen.findByRole("heading", { name: "Existing DuskDS repository is read-only" });
    expect(screen.getByText(/1 recovery entry found/)).toBeInTheDocument();
    expect(screen.getByText("Selected recovery")).toBeInTheDocument();
    expect(screen.queryByText("No recorded blocker")).not.toBeInTheDocument();
    await waitFor(() => expect(recoveryHeading.closest("article")).toHaveFocus());
  });

  it("renders fail-closed self-contained project and artifact command blocks", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));

    const prepare = screen.getByRole("heading", { name: "Prepare project" }).parentElement?.querySelector("pre")?.textContent ?? "";
    expect(prepare).toContain("Node.js >=24.18.0 <25 is required before starter creation.");
    expect(prepare).toContain("npm.cmd --version");
    expect(prepare).not.toContain("npm --version");
    expect(prepare.indexOf("process.versions.node")).toBeLessThan(prepare.indexOf("New-Item"));
    expect(prepare).toContain(`npx.cmd --yes dusk-developer-studio@${DUSK_STUDIO_NPM_PACKAGE_VERSION} create-duskds`);
    expect(prepare).toContain("Reviewed DuskDS template creation failed; no existing target was overwritten.");
    expect(prepare).not.toContain("$forgeReceipt");
    expect(prepare).not.toContain("$forgeExe");
    expect(prepare).not.toContain("Remove-Item");
    expect(prepare).toContain("Set-Location -LiteralPath 'C:\\tmp\\dusk-studio-projects\\duskds-forge-starter' -ErrorAction Stop");
    const build = screen.getByRole("heading", { name: "Build contract + data-driver WASM" }).parentElement?.querySelector("pre")?.textContent ?? "";
    expect(build).toContain("Dusk Forge check failed.");
    expect(build).toContain("Dusk Forge build failed.");
    const locate = screen.getByRole("heading", { name: "Locate WASM files and byte sizes" }).parentElement?.querySelector("pre")?.textContent ?? "";
    const hash = screen.getByRole("heading", { name: "Calculate WASM SHA-256 values" }).parentElement?.querySelector("pre")?.textContent ?? "";
    expect(locate.startsWith("Set-Location -LiteralPath")).toBe(true);
    expect(hash.startsWith("Set-Location -LiteralPath")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    const linuxBuild = screen.getByRole("heading", { name: "Build contract + data-driver WASM" }).parentElement?.querySelector("pre")?.textContent ?? "";
    expect(linuxBuild).toMatch(/^\(\nset -e\n/);
    expect(linuxBuild.trimEnd().endsWith(")")).toBe(true);
    expect(linuxBuild).toContain('PATH="$forgeBin:$PATH"');
    expect(linuxBuild).toContain('"$forgeExe" check');
    expect(linuxBuild).toContain('"$forgeExe" build all');
    const linuxLocate = screen.getByRole("heading", { name: "Locate WASM files and byte sizes" }).parentElement?.querySelector("pre")?.textContent ?? "";
    const linuxHash = screen.getByRole("heading", { name: "Calculate WASM SHA-256 values" }).parentElement?.querySelector("pre")?.textContent ?? "";
    expect(linuxLocate).toMatch(/^\(\nset -e\n/);
    expect(linuxLocate.trimEnd().endsWith(")")).toBe(true);
    expect(linuxHash).toMatch(/^\(\nset -e\n/);
    expect(linuxHash).toContain("sha256sum");

    fireEvent.click(screen.getByRole("button", { name: "macOS shell" }));
    const macLocate = screen.getByRole("heading", { name: "Locate WASM files and byte sizes" }).parentElement?.querySelector("pre")?.textContent ?? "";
    const macHash = screen.getByRole("heading", { name: "Calculate WASM SHA-256 values" }).parentElement?.querySelector("pre")?.textContent ?? "";
    expect(macLocate).toMatch(/^\(\nset -e\n/);
    expect(macLocate).not.toContain("-maxdepth");
    expect(macLocate).toContain("wc -c");
    expect(macHash).toContain("shasum -a 256");
    expect(macHash).not.toContain("sha256sum");

    const allCommands = Array.from(document.querySelectorAll("pre")).map((node) => node.textContent ?? "").join("\n");
    expect(allCommands).not.toMatch(/(?:^|[;\n]\s*)dusk-forge\s+(?:new|check|build|test)\b/m);
  });

  it("records macOS evidence exactly but withholds native VM-test evidence controls", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "macOS shell" }));

    expect(screen.getByText(/npm runtime and Local Actions lifecycle are supported on macOS/)).toBeInTheDocument();
    expect(screen.getByText("macOS", { selector: ".command-context .status-pill" })).toBeInTheDocument();
    expect(screen.getByText("Build: macOS shell")).toBeInTheDocument();
    expect(screen.getByText("VM tests: self-managed Linux required")).toBeInTheDocument();
    expect(screen.queryByText(/reviewed POSIX VM-test lane/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I observed the VM test pass in this environment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Run the VM test" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cargo.toml is present" }));
    fireEvent.click(screen.getByRole("button", { name: /rust-toolchain\.toml pins/ }));
    fireEvent.change(screen.getByLabelText("Source identity"), { target: { value: "a".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as {
        paths: { duskds: { build: { evidenceEntries: Array<{ code: string; metadata?: { platform?: string } }> } } };
      };
      expect(stored.paths.duskds.build.evidenceEntries.find(
        (entry) => entry.code === "duskds-starter-structure"
      )?.metadata?.platform).toBe("macos");
    });
  });

  it("restores saved hosted Access evidence without contradicting the recorded result", () => {
    const observedAt = new Date().toISOString();
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "access",
      ["duskds-node-read-attestation"],
      {
        method: "automatic",
        observedAt,
        metadata: {
          blockHeight: 3_838_440,
          blockHash: "a".repeat(64),
          endpoint: "https://testnet.nodes.dusk.network/on/graphql/query"
        }
      }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#access";

    render(<App />);

    expect(screen.getByText(/Saved observation: block 3838440/)).toBeInTheDocument();
    expect(screen.queryByText("No hosted node check has run in this page visit.")).not.toBeInTheDocument();
    expect(screen.getByText("available here")).toBeInTheDocument();
    expect(screen.getByText(/One bounded, read-only public-node request from this browser/)).toBeInTheDocument();
    expect(screen.getByText("3838440", { selector: "dd" })).toBeInTheDocument();
  });

  it("revokes saved manual Setup evidence when a required tool is unmarked", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#setup";
    render(<App />);

    for (const button of screen.getAllByRole("button", { name: /^Mark .+ as checked$/ })) {
      fireEvent.click(button);
    }
    fireEvent.click(screen.getByRole("button", { name: "Save manual setup confirmation" }));
    await waitFor(() => expect(screen.getByText("Confirmed manually", { selector: ".done-panel .status-pill" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Unmark Git as checked" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.setup.evidence).toEqual([]);
      expect(stored.paths.duskds.access.evidence).toEqual([]);
    });
    expect(screen.queryByText("Confirmed manually", { selector: ".done-panel .status-pill" })).not.toBeInTheDocument();
  });

  it.each(["Linux shell", "macOS shell"])(
    "clears all Windows Setup confirmations when switching to %s",
    async (targetPlatform) => {
      window.localStorage.setItem("dusk-studio-builder-path", "duskds");
      window.location.hash = "#setup";
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "macOS shell" }));
      fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));
      for (const button of screen.getAllByRole("button", { name: /^Mark .+ as checked$/ })) {
        fireEvent.click(button);
      }
      fireEvent.click(screen.getByRole("button", { name: "Save manual setup confirmation" }));
      await waitFor(() => expect(screen.getByText("Confirmed manually", { selector: ".done-panel .status-pill" })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: targetPlatform }));

      expect(screen.getByRole("button", { name: "Save manual setup confirmation" })).toBeDisabled();
      expect(screen.getAllByRole("button", { name: /^Mark .+ as checked$/ }).length).toBeGreaterThan(0);
      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
        expect(stored.paths.duskds.setup.evidence).toEqual([]);
      });
    }
  );

  it.each(["Linux shell", "macOS shell"])(
    "clears all Windows Access inputs and confirmations when switching to %s",
    async (targetPlatform) => {
      const progress = recordJourneyEvidence(
        createInitialJourneyProgress(),
        "duskds",
        "setup",
        ["duskds-required-preflight"],
        { method: "automatic" }
      );
      window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
      window.localStorage.setItem("dusk-studio-builder-path", "duskds");
      window.location.hash = "#access";
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
      fireEvent.click(screen.getByRole("button", { name: "macOS shell" }));
      fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));
      fireEvent.click(screen.getByRole("button", { name: "Mark Deno as checked" }));
      fireEvent.change(screen.getByLabelText("Block height"), { target: { value: "3820996" } });
      fireEvent.change(screen.getByLabelText("Block hash"), { target: { value: "a".repeat(64) } });
      fireEvent.click(screen.getByRole("button", { name: "Save manual node observation" }));
      await waitFor(() => expect(screen.getByText("Confirmed manually", { selector: ".done-panel .status-pill" })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: targetPlatform }));

      expect(screen.getByLabelText("Block height")).toHaveValue("");
      expect(screen.getByLabelText("Block hash")).toHaveValue("");
      expect(screen.getByRole("button", { name: "Save manual node observation" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Mark Deno as checked" })).toBeInTheDocument();
      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
        expect(stored.paths.duskds.access.evidence).toEqual([]);
      });
    }
  );

  it("invalidates Build and Inspect evidence when the project context changes", async () => {
    let progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { method: "manual", metadata: { revision: "a".repeat(40) } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-latest-block", "duskds-inspect-artifact-revision"],
      { method: "manual", metadata: { revision: "a".repeat(40) } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#build";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Existing repository/ }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
      expect(stored.paths.duskds.build.evidence).toEqual([]);
      expect(stored.paths.duskds.inspect.evidence).toEqual([]);
    });
  });

  it("offers Local Studio setup and a manual fallback for a hosted new starter", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";
    render(<App />);

    const completionMethod = screen.getByRole("group", { name: "Choose how to complete this task" });
    fireEvent.click(within(completionMethod).getByRole("button", { name: /Local Studio/i }));

    expect(screen.getByRole("heading", { name: "Start Local Studio to create the reviewed starter" })).toBeInTheDocument();
    expect(screen.getByText(/Local Studio can create the new starter inside its approved project root/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Local Studio setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue manually" })).toBeInTheDocument();
  });

  it("keeps the existing-project choice across routes without persisting its path", () => {
    const sensitiveRoot = "C:\\Users\\George\\private-existing-project";
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";
    render(<App />);

    const existingProject = screen.getByRole("button", { name: /Existing repository/ });
    fireEvent.click(existingProject);
    fireEvent.change(screen.getByLabelText("Existing project root"), { target: { value: sensitiveRoot } });
    const completionMethod = screen.getByRole("group", { name: "Choose how to complete this task" });
    fireEvent.click(within(completionMethod).getByRole("button", { name: /Local Studio/i }));

    expect(screen.getByRole("heading", { name: "Local Actions does not attach to existing repositories" })).toBeInTheDocument();
    expect(screen.getByText(/does not attach to, import, crawl, or write to an existing repository/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with manual existing-repo checks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Local Studio setup" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("dusk-studio-duskds-build-project-mode")).toBe("existing");
    const savedSessionValues = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "")
    );
    expect(savedSessionValues).not.toContain(sensitiveRoot);

    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to DuskDS at Build" }));

    expect(screen.getByRole("button", { name: /Existing repository/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Existing project root")).toHaveValue("");
    const restoredSessionValues = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "")
    );
    expect(restoredSessionValues).not.toContain(sensitiveRoot);
  });

  it("revokes saved artifact evidence when a recorded artifact input changes", async () => {
    let progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { method: "manual", metadata: { revision: "a".repeat(40) } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-latest-block"],
      { method: "manual" }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#build";
    render(<App />);

    fireEvent.change(screen.getAllByLabelText("SHA-256")[0], { target: { value: "d".repeat(64) } });

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
      expect(stored.paths.duskds.build.evidence).not.toContain("duskds-build-artifact-attestation");
      expect(stored.paths.duskds.build.evidence).toContain("duskds-vm-test-attestation");
      expect(stored.paths.duskds.inspect.evidence).toEqual([]);
    });
  });

  it("removes only VM evidence when its toggle is cleared and allows a fresh resave", async () => {
    const revision = "a".repeat(40);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    fireEvent.click(screen.getByRole("button", { name: "Cargo.toml is present" }));
    fireEvent.click(screen.getByRole("button", { name: /rust-toolchain\.toml pins/ }));
    fireEvent.change(screen.getByLabelText("Source identity"), { target: { value: revision } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual structure confirmation" }));

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: revision } });
    const names = screen.getAllByLabelText("Filename");
    const hashes = screen.getAllByLabelText("SHA-256");
    const sizes = screen.getAllByLabelText("Size in bytes");
    fireEvent.change(names[0], { target: { value: "counter-contract.wasm" } });
    fireEvent.change(hashes[0], { target: { value: "b".repeat(64) } });
    fireEvent.change(sizes[0], { target: { value: "1234" } });
    fireEvent.change(names[1], { target: { value: "counter-data-driver.wasm" } });
    fireEvent.change(hashes[1], { target: { value: "c".repeat(64) } });
    fireEvent.change(sizes[1], { target: { value: "2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual artifact evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "I observed the VM test pass in this environment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save manual VM-test evidence" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.build.evidence).toEqual(expect.arrayContaining([
        "duskds-starter-structure",
        "duskds-build-artifact-attestation",
        "duskds-vm-test-attestation"
      ]));
    });

    fireEvent.click(screen.getByRole("button", { name: "I observed the VM test pass in this environment" }));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.build.evidence).toEqual(expect.arrayContaining([
        "duskds-starter-structure",
        "duskds-build-artifact-attestation"
      ]));
      expect(stored.paths.duskds.build.evidence).not.toContain("duskds-vm-test-attestation");
    });

    fireEvent.click(screen.getByRole("button", { name: "I observed the VM test pass in this environment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save manual VM-test evidence" }));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as ReturnType<typeof createInitialJourneyProgress>;
      expect(stored.paths.duskds.build.evidence).toContain("duskds-vm-test-attestation");
    });
  });

  it("blocks VM-first evidence and removes a legacy VM receipt when its revision changes", async () => {
    const oldRevision = "a".repeat(40);
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-vm-test-attestation"],
      { method: "manual", metadata: { revision: oldRevision, platform: "linux" } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#build";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));

    expect(screen.getByRole("button", { name: "Save manual VM-test evidence" })).toBeDisabled();
    expect(screen.getByText(/Save the artifact evidence before recording the VM-test pass/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: "b".repeat(40) } });

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
      expect(stored.paths.duskds.build.evidence).toContain("duskds-starter-structure");
      expect(stored.paths.duskds.build.evidence).not.toContain("duskds-vm-test-attestation");
    });
  });

  it("keeps deployment readiness separate from post-deploy Inspect completion", () => {
    const revision = "a".repeat(40);
    let progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "setup",
      ["duskds-required-preflight"]
    );
    progress = recordJourneyEvidence(progress, "duskds", "access", ["duskds-node-read-attestation"]);
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { metadata: { revision } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-artifact-revision"],
      { metadata: { revision } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    expect(screen.getByText("Pre-deploy evidence ready")).toBeInTheDocument();
    expect(screen.getByText("Ready to start", { selector: ".done-panel .status-pill" })).toBeInTheDocument();
    expect(screen.queryByText("Confirmed manually", { selector: ".done-panel .status-pill" })).not.toBeInTheDocument();
    const readiness = screen.getByLabelText("Manual deployment readiness");
    expect(within(readiness).getAllByText("Ready")).toHaveLength(4);
    const readinessPanel = readiness.closest("section");
    expect(readinessPanel).not.toBeNull();
    const deployTemplate = within(readinessPanel as HTMLElement).getByText(/--address "<PUBLIC_TESTNET_ADDRESS>"/);
    expect(deployTemplate).not.toHaveTextContent(/mnemonic|private key|wallet password/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue to post-deploy inspection" }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByLabelText("Deployed contract ID")).toHaveFocus();
  });

  it("sends an unfinished Inspect journey to the readiness gate", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Review deployment readiness" }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.getElementById("duskds-deploy-readiness")).toHaveFocus();
  });

  it("opens Reference with the completed journey receipt after Inspect is complete", () => {
    const revision = "a".repeat(40);
    let progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "setup",
      ["duskds-required-preflight"]
    );
    progress = recordJourneyEvidence(progress, "duskds", "access", ["duskds-node-read-attestation"]);
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { metadata: { revision } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      [
        "duskds-inspect-latest-block",
        "duskds-inspect-artifact-revision",
        "duskds-inspect-driver-availability",
        "duskds-inspect-driver-schema",
        "duskds-inspect-driver-encode",
        "duskds-inspect-driver-decode"
      ],
      { metadata: { revision } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Open reference" }));
    expect(window.location.hash).toBe("#duskds/reference");
    expect(screen.getByRole("button", { name: "Return to DuskDS at Inspect" })).toHaveTextContent("4/4 complete");
  });

  it("rejects and focuses an Inspect source identity that does not match Build", async () => {
    const revision = "a".repeat(40);
    let progress = progressThroughDuskDsBuild(revision);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: "b".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save source match" }));

    const sourceIdentity = screen.getByLabelText("Artifact source identity");
    expect(screen.getByRole("alert")).toHaveTextContent("same source identity recorded for both Build artifacts and the VM test");
    expect(sourceIdentity).toHaveAttribute("aria-invalid", "true");
    expect(sourceIdentity).toHaveAccessibleDescription(/same source identity recorded for both Build artifacts and the VM test/);
    await waitFor(() => expect(sourceIdentity).toHaveFocus());
    progress = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
    expect(progress.paths.duskds.inspect.evidence).not.toContain("duskds-inspect-artifact-revision");
  });

  it("associates every data-driver validation failure with the field or confirmation that can fix it", async () => {
    const revision = "a".repeat(40);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsBuild(revision)));
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Save availability confirmation" }));
    const sourceIdentity = screen.getByLabelText("Artifact source identity");
    expect(sourceIdentity).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(sourceIdentity).toHaveFocus());

    fireEvent.change(sourceIdentity, { target: { value: revision } });
    fireEvent.click(screen.getByRole("button", { name: "Save source match" }));
    const availabilityToggle = screen.getByRole("button", { name: "I observed driver_available: true in contract metadata" });
    fireEvent.click(availabilityToggle);
    fireEvent.change(screen.getByLabelText("Metadata response SHA-256"), { target: { value: "b".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability confirmation" }));

    const contractId = screen.getByLabelText("Deployed contract ID");
    expect(contractId).toHaveAttribute("aria-invalid", "true");
    expect(contractId).toHaveAccessibleDescription(/deployed 32-byte contract ID/);
    await waitFor(() => expect(contractId).toHaveFocus());

    fireEvent.change(contractId, { target: { value: "c".repeat(64) } });
    fireEvent.click(availabilityToggle);
    fireEvent.click(screen.getByRole("button", { name: "Save availability confirmation" }));
    const availabilityDigest = screen.getByLabelText("Metadata response SHA-256");
    expect(availabilityDigest).toHaveAttribute("aria-invalid", "true");
    expect(availabilityDigest).toHaveAccessibleDescription(/SHA-256 of the exact response body/);
    await waitFor(() => expect(availabilityDigest).toHaveFocus());

    fireEvent.change(availabilityDigest, { target: { value: "d".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability confirmation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save schema confirmation" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Save schema confirmation" }));
    const schemaToggle = screen.getByRole("button", { name: "I observed a non-empty schema" });
    expect(schemaToggle).toHaveAttribute("aria-invalid", "true");
    expect(schemaToggle).toHaveAccessibleDescription(/Confirm the schema result/);
    await waitFor(() => expect(schemaToggle).toHaveFocus());

    const encodeToggle = screen.getByRole("button", { name: "I observed valid input encoding" });
    fireEvent.click(encodeToggle);
    fireEvent.change(screen.getByLabelText("Encode response SHA-256"), { target: { value: "e".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save encode confirmation" }));
    const functionName = screen.getByLabelText("Function name for encode / decode");
    expect(functionName).toHaveAttribute("aria-invalid", "true");
    expect(functionName).toHaveAccessibleDescription(/exact contract function name/);
    await waitFor(() => expect(functionName).toHaveFocus());
  });

  it("requires matching contract metadata before accepting driver observations", async () => {
    const revision = "a".repeat(40);
    let progress = progressThroughDuskDsBuild(revision);
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-artifact-revision"],
      { metadata: { revision } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    const metadataLinux = screen.getByRole("heading", { name: "Fetch, inspect + hash metadata on Linux" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    const metadataMac = screen.getByRole("heading", { name: "Fetch, inspect + hash metadata on macOS" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    const metadataWindows = screen.getByRole("heading", { name: "Fetch, inspect + hash metadata on Windows" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    expect(metadataLinux).toMatch(/^\(\nset -e\n/);
    expect(metadataLinux).toContain('metadataTemp="$metadataFinal.tmp.$$"');
    expect(metadataLinux).toContain("curl --fail-with-body --silent --show-error");
    expect(metadataLinux.indexOf('mv -f -- "$metadataTemp" "$metadataFinal"'))
      .toBeLessThan(metadataLinux.indexOf('cat -- "$metadataFinal"'));
    expect(metadataLinux).toContain('sha256sum "$metadataFinal"');
    expect(metadataMac).toContain('shasum -a 256 "$metadataFinal"');
    expect(metadataMac).not.toContain("sha256sum");
    expect(metadataWindows).toContain("$metadataTemp = \"$metadataFinal.tmp.$PID\"");
    expect(metadataWindows).toContain("-OutFile $metadataTemp -ErrorAction Stop");
    expect(metadataWindows.indexOf("Move-Item -LiteralPath $metadataTemp"))
      .toBeLessThan(metadataWindows.indexOf("Get-Content -Raw -LiteralPath $metadataFinal"));
    expect(metadataWindows).toContain("finally {");

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: revision } });
    fireEvent.change(screen.getByLabelText("Deployed contract ID"), { target: { value: "b".repeat(64) } });
    expect(screen.getAllByText((content, element) => element?.tagName === "PRE"
      && content.includes('cat -- "$metadataFinal"'))).toHaveLength(2);
    expect(screen.getByText((content, element) => element?.tagName === "PRE"
      && content.includes("Get-Content -Raw -LiteralPath $metadataFinal"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toBeDisabled();
    expect(screen.getByLabelText("Schema response SHA-256")).toBeDisabled();
    expect(screen.queryByText(/\/on\/driver:<contract_id>\/get_schema/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "I observed driver_available: true in contract metadata" }));
    fireEvent.change(screen.getByLabelText("Metadata response SHA-256"), { target: { value: "d".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability confirmation" }));
    expect(await screen.findAllByText(/\/on\/driver:<contract_id>\/get_schema/)).toHaveLength(3);
    expect(screen.getAllByText((content, element) => element?.tagName === "PRE"
      && content.includes('cat -- "$schemaFinal"'))).toHaveLength(2);
    expect(screen.getByText((content, element) => element?.tagName === "PRE"
      && content.includes("Get-Content -Raw -LiteralPath $schemaFinal"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toBeEnabled();
    const driverLinux = screen.getByRole("heading", { name: "Fetch, inspect + hash driver responses on Linux" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    const driverWindows = screen.getByRole("heading", { name: "Fetch, inspect + hash driver responses on Windows" })
      .parentElement?.querySelector("pre")?.textContent ?? "";
    const firstLinuxMove = driverLinux.indexOf('mv -f -- "$schemaTemp" "$schemaFinal"');
    expect(driverLinux.indexOf('--output "$decodeTemp"')).toBeLessThan(firstLinuxMove);
    expect(driverLinux.indexOf('cat -- "$schemaFinal"')).toBeGreaterThan(firstLinuxMove);
    const firstWindowsMove = driverWindows.indexOf("Move-Item -LiteralPath $schemaTemp");
    expect(driverWindows.indexOf("-OutFile $decodeTemp -ErrorAction Stop")).toBeLessThan(firstWindowsMove);
    expect(driverWindows.indexOf("Get-Content -Raw -LiteralPath $schemaFinal")).toBeGreaterThan(firstWindowsMove);
    fireEvent.click(screen.getByRole("button", { name: "I observed a non-empty schema" }));
    fireEvent.change(screen.getByLabelText("Schema response SHA-256"), { target: { value: "c".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save schema confirmation" }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
      expect(stored.paths.duskds.inspect.evidence).toContain("duskds-inspect-driver-availability");
      expect(stored.paths.duskds.inspect.evidence).toContain("duskds-inspect-driver-schema");
    });
  });

  it("clears stale driver confirmations and digests when the deployed identity changes", async () => {
    const revision = "a".repeat(40);
    const contractId = "b".repeat(64);
    let progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { metadata: { revision } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-artifact-revision"],
      { metadata: { revision } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-driver-availability"],
      { metadata: { revision, contractId, responseSha256: "c".repeat(64) } }
    );
    progress = recordJourneyEvidence(
      progress,
      "duskds",
      "inspect",
      ["duskds-inspect-driver-schema"],
      { metadata: { revision, contractId, responseSha256: "d".repeat(64) } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    expect(screen.getByRole("button", { name: "I observed driver_available: true in contract metadata" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Metadata response SHA-256")).toHaveValue("c".repeat(64));
    expect(screen.getByLabelText("Schema response SHA-256")).toHaveValue("d".repeat(64));

    fireEvent.change(screen.getByLabelText("Deployed contract ID"), { target: { value: "e".repeat(64) } });

    expect(screen.getByRole("button", { name: "I observed driver_available: true in contract metadata" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Metadata response SHA-256")).toHaveValue("");
    expect(screen.getByLabelText("Schema response SHA-256")).toHaveValue("");
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toBeDisabled();

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
      expect(stored.paths.duskds.inspect.evidence).not.toContain("duskds-inspect-driver-availability");
      expect(stored.paths.duskds.inspect.evidence).not.toContain("duskds-inspect-driver-schema");
    });
  });

  it("restores the saved automatic latest-block receipt on revisit", () => {
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "inspect",
      ["duskds-inspect-latest-block"],
      {
        method: "automatic",
        observedAt: "2026-07-19T08:15:00.000Z",
        metadata: {
          source: "browser-check",
          tool: "rpc",
          platform: "browser",
          blockHeight: 12345,
          blockHash: "a".repeat(64),
          endpoint: "https://testnet.nodes.dusk.network"
        }
      }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    expect(screen.getByText(/Saved observation: latest block 12345/)).toBeInTheDocument();
    expect(screen.getByText("12345", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByText("Latest-block inspection has not run.")).not.toBeInTheDocument();
  });

  it("opens and focuses the exact data-driver recovery entry", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Open data-driver recovery" }));

    expect(window.location.hash).toBe("#duskds/troubleshooting");
    const heading = await screen.findByRole("heading", { name: "The deployed contract's data driver is unavailable" });
    await waitFor(() => expect(heading.closest("article")).toHaveFocus());
    expect(screen.getByText("1 recovery entry found.")).toBeInTheDocument();
  });
});
