import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_PRODUCT, type StudioRelease } from "../release";
import { App } from "../app/App";
import { getStudioRuntime } from "../app/runtime";

const npmCommit = "a".repeat(40);
const npmRelease: StudioRelease = { product: STUDIO_PRODUCT, version: "1.2.3", commit: npmCommit, channel: "npm" };

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
    expect(screen.getByText("Guide and local tools available")).toBeInTheDocument();
    expect(screen.getByText("Reference only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Explore pre-launch reference/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start DuskDS/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Troubleshoot" })).toBeInTheDocument();
  });

  it("opens DuskEVM as one pre-launch reference without a completion score", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Explore pre-launch reference/i }));

    expect(window.location.hash).toBe("#reference");
    expect(screen.getByRole("heading", { name: "Source-backed context for the task in front of you." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DuskEVM only" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Resume DuskEVM/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/0\/4/)).not.toBeInTheDocument();
  });

  it("keeps DuskEVM as one pre-launch learning surface and shows release identity", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    expect(screen.getByText("No live evidence is recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy pre-launch RPC URL" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/v0\.1\.0-test/)).toBeInTheDocument();
  });

  it("does not expose EVM scaffold or deployment actions during pre-launch", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#build";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    expect(screen.queryByText(/forge create|cast wallet import|Create and verify Counter starter/i)).not.toBeInTheDocument();
  });

  it("gates the current DuskDS data-driver HTTP surface behind matching metadata", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#inspect";
    render(<App />);

    expect(screen.getByText("/on/contract:<contract_id>/metadata", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Driver routes stay disabled until you save metadata evidence/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toBeDisabled();
    expect(screen.queryByText(/\/on\/driver:<contract_id>\/get_schema/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/rues\/contract/)).not.toBeInTheDocument();
  });

  it("guards a pathless guide deep link and preserves its destination after path choice", () => {
    window.location.hash = "#build";
    render(<App />);

    expect(screen.getByRole("heading", { name: "Choose a path to continue to Build." })).toBeInTheDocument();
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    expect(screen.getByRole("heading", { name: "Build contract and data-driver WASM together." })).toBeInTheDocument();
    expect(window.location.hash).toBe("#build");
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
  });

  it("shows maturity, source status, and freshness in references", () => {
    window.location.hash = "#reference";
    render(<App />);
    expect(screen.getAllByText(/reviewed July 19, 2026/).length).toBeGreaterThan(2);
    expect(screen.getAllByText("Pre-launch Testnet reference").length).toBeGreaterThan(0);
    expect(screen.getByText("pre-launch metadata")).toBeInTheDocument();
    expect(screen.getAllByText("reference only")).toHaveLength(2);
  });

  it("keeps active DuskDS recovery separate from pre-launch EVM planning", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    expect(screen.getByRole("heading", { name: "Fix the blocker in front of you." })).toBeInTheDocument();
    expect(screen.getAllByText("Cause and fix").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recheck").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Wallet is on the wrong chain" })).not.toBeInTheDocument();
  });

  it("requires an inline confirmation before resetting browser-local progress", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");

    fireEvent.click(screen.getByRole("button", { name: "Build & browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
    expect(screen.getByRole("button", { name: "Reset browser progress" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset browser progress" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    expect(screen.getByRole("button", { name: "All references" })).toHaveClass("active");
    expect(screen.queryByRole("button", { name: "DuskDS only" })).not.toBeInTheDocument();
  });

  it("announces successful copy feedback without changing the button name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Copy pre-launch RPC URL" }));

    await waitFor(() => expect(screen.getByText("Copy pre-launch RPC URL copied to clipboard.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy pre-launch RPC URL" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("keeps source-development builds in hosted-guide mode without a manual token path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "source-dev")} />);

    fireEvent.click(screen.getByRole("button", { name: /Automation/i }));
    expect(screen.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue in the hosted guide" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("keeps a hosted artifact in guide mode on loopback without making companion requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime("127.0.0.1", "hosted")} />);

    fireEvent.click(screen.getByRole("button", { name: /Automation/i }));
    expect(screen.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("bootstraps an npm same-origin session and requires exact release parity", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Automation: Actions ready/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Automation/i }));
    expect(screen.getByText("Paired. Local capabilities are enabled.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Local Studio is paired and ready." })).toBeInTheDocument();
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

  it("blocks local actions when the companion release does not match", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: { ...npmRelease, commit: "b".repeat(40) } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /Automation/i }));
    expect(screen.getByText(/release identities do not match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paths" }));
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    fireEvent.click(screen.getByRole("button", { name: /3 Build/i }));
    expect(screen.getByRole("button", { name: "Resolve local release mismatch" })).toBeInTheDocument();
  });
});
