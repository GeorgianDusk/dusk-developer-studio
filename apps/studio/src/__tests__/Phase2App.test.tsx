import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { JOURNEY_PROGRESS_STORAGE_KEY } from "../app/journeyProgress";

describe("Phase 2 evidence journeys", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "ethereum", { value: undefined, configurable: true, writable: true });
  });

  it("verifies wallet evidence without persisting the account or balance", async () => {
    window.location.hash = "#setup";
    const account = `0x${"a".repeat(40)}`;
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_chainId") return "0x2e9";
        if (method === "eth_requestAccounts") return [account];
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        throw new Error(`unexpected ${method}`);
      })
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Verify Testnet wallet" }));
    await waitFor(() => expect(screen.getByText(/read-only balance 1 DUSK/)).toBeInTheDocument());
    await waitFor(() => expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)).toContain("evm-wallet-account"));
    const stored = window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)!;
    expect(stored).not.toContain(account);
    expect(stored).not.toContain("1000000000000000000");
  });

  it("classifies and records a read-only contract-code inspection", async () => {
    window.location.hash = "#inspect";
    const address = `0x${"b".repeat(40)}`;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x60016000" }) })));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Testnet identifier"), { target: { value: address } });
    expect(screen.getByText("address")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect read-only" }));
    await waitFor(() => expect(screen.getByText("Contract bytecode is present at this address.")).toBeInTheDocument());
    await waitFor(() => expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)).toContain("evm-read-inspection"));
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)).not.toContain(address);
  });

  it("keeps native completion explicit when the browser cannot observe the terminal", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Record observed height + hash" }));
    await waitFor(() => expect(screen.getByText("verified", { selector: ".done-panel .status-pill" })).toBeInTheDocument());
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)).toContain("duskds-node-read-attestation");
  });
});
