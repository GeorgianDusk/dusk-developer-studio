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

  it("keeps the DuskEVM wallet action disabled during pre-launch", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    const provider = {
      request: vi.fn()
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    expect(screen.getByRole("button", { name: "Available after Testnet launch" })).toBeDisabled();
    expect(provider.request).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-wallet-account");
  });

  it("classifies an EVM identifier locally but defers network inspection", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    const address = `0x${"b".repeat(40)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Future Testnet identifier"), { target: { value: address } });
    expect(screen.getByText("address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Network inspection available after Testnet launch" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-read-inspection");
  });

  it("exposes invalid Inspect input through the field description", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    render(<App />);

    const input = screen.getByLabelText("Future Testnet identifier");
    fireEvent.change(input, { target: { value: "not-an-identifier" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Identifier not recognized/);
    expect(screen.getByRole("button", { name: "Network inspection available after Testnet launch" })).toBeDisabled();
  });

  it("keeps native completion explicit when the browser cannot observe the terminal", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#access";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Record observed height + hash" }));
    await waitFor(() => expect(screen.getByText("verified", { selector: ".done-panel .status-pill" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("DuskDS Access verified. 1 of 4 journey steps verified.")).toBeInTheDocument());
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY)).toContain("duskds-node-read-attestation");
  });
});
