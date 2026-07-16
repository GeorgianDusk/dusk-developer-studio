import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_PRODUCT, type StudioRelease } from "../release";
import { App } from "../app/App";
import { getStudioRuntime } from "../app/runtime";

const portableCommit = "a".repeat(40);
const portableRelease: StudioRelease = { product: STUDIO_PRODUCT, version: "1.2.3", commit: portableCommit, channel: "portable" };

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("renders the guided studio path chooser", () => {
    render(<App />);
    expect(screen.getByText("Developer Studio")).toBeInTheDocument();
    expect(screen.getByText("Choose your path")).toBeInTheDocument();
    expect(screen.getByText("Pick the execution model your app actually needs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Solidity path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start native path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Troubleshoot" })).toBeInTheDocument();
  });

  it("locks interactive EVM actions to Testnet and shows release identity", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    render(<App />);
    expect(screen.getByText("Check the DuskEVM Testnet RPC")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/v0\.1\.0-test/)).toBeInTheDocument();
  });

  it("uses the actual Counter starter contract in deploy guidance", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#build";
    render(<App />);
    expect(screen.getByText(/src\/Counter\.sol:Counter/)).toBeInTheDocument();
    expect(screen.queryByText(/YourContract/)).not.toBeInTheDocument();
  });

  it("guards a pathless guide deep link and preserves its destination after path choice", () => {
    window.location.hash = "#build";
    render(<App />);

    expect(screen.getByRole("heading", { name: "Choose a path to continue to Build." })).toBeInTheDocument();
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Start native path/i }));
    expect(screen.getByRole("heading", { name: "Build contract and data-driver WASM together." })).toBeInTheDocument();
    expect(window.location.hash).toBe("#build");
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
  });

  it("shows maturity, source status, and freshness in references", () => {
    window.location.hash = "#reference";
    render(<App />);
    expect(screen.getAllByText(/checked July 3, 2026/).length).toBeGreaterThan(2);
    expect(screen.getAllByText("ready-testnet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("read-only reference")).toHaveLength(2);
  });

  it("requires an inline confirmation before resetting browser-local progress", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start native path/i }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");

    fireEvent.click(screen.getByRole("button", { name: "Release & local data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset local progress" }));
    expect(screen.getByRole("button", { name: "Reset all progress" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset local progress" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Reset local progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset all progress" }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    expect(screen.getByRole("button", { name: "All references" })).toHaveClass("active");
    expect(screen.queryByRole("button", { name: "DuskDS only" })).not.toBeInTheDocument();
  });

  it("announces successful copy feedback without changing the button name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start Solidity path/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy RPC URL" }));

    await waitFor(() => expect(screen.getByText("Copy RPC URL copied to clipboard.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy RPC URL" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("keeps source-development builds docs-only without a manual token path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "source-dev")} />);

    fireEvent.click(screen.getByRole("button", { name: /Local runtime/i }));
    expect(screen.getByRole("heading", { name: "Machine actions are unavailable in this build." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("keeps a hosted artifact docs-only on loopback without making companion requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime("127.0.0.1", "hosted")} />);

    fireEvent.click(screen.getByRole("button", { name: /Local runtime/i }));
    expect(screen.getByRole("heading", { name: "Machine actions are unavailable in this build." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("bootstraps a portable same-origin session and requires exact release parity", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: portableRelease })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "portable")} release={portableRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Local runtime: Actions ready/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Local runtime/i }));
    expect(screen.getByText("Paired. Local capabilities are enabled.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Local runtime, bound to this exact release." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      window.location.origin + "/__dusk/bootstrap",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://" + window.location.hostname + ":8788/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("blocks portable actions when the companion release does not match", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: { ...portableRelease, commit: "b".repeat(40) } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "portable")} release={portableRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /Local runtime/i }));
    expect(screen.getByText(/release identities do not match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paths" }));
    fireEvent.click(screen.getByRole("button", { name: /Start Solidity path/i }));
    fireEvent.click(screen.getByRole("button", { name: /3 Build/i }));
    expect(screen.getByRole("button", { name: "Resolve local release mismatch" })).toBeInTheDocument();
  });
});
