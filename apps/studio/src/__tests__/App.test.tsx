import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_PRODUCT, STUDIO_RELEASE, type StudioRelease } from "../release";
import { App } from "../app/App";
import { createInitialJourneyProgress, JOURNEY_PROGRESS_STORAGE_KEY, recordJourneyEvidence } from "../app/journeyProgress";
import { getStudioRuntime } from "../app/runtime";

const npmCommit = "a".repeat(40);
const npmRelease: StudioRelease = { product: STUDIO_PRODUCT, version: "1.2.3", commit: npmCommit, channel: "npm" };
const reviewedTemplateRevision = "d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a";
const reviewedTemplateLock = "1408051342213d41a91342497b18856c87afc3bc0eeb1c750932e634525445da";

function scaffoldReceipt(projectPath: string, recovered = false, runtimeOs: "windows" | "linux" | "macos" = "windows") {
  return {
    ok: true,
    projectName: "duskds-forge-starter",
    projectPath,
    recovered,
    rustToolchain: "1.94.0",
    runtimeOs,
    structureVerified: true,
    files: ["Cargo.toml", "rust-toolchain.toml"],
    template: "duskds-counter-forge",
    templateSource: "https://github.com/dusk-network/forge",
    templateRevision: reviewedTemplateRevision,
    templateLockSha256: reviewedTemplateLock
  };
}

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

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = "";
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  });

  afterEach(() => {
    window.dispatchEvent(new Event("beforeunload"));
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
    expect(screen.getByRole("button", { name: /Open pre-launch overview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start DuskDS/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose a builder path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reference" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Troubleshoot" })).toBeInTheDocument();
  });

  it("opens the DuskEVM pre-launch overview and identifier helper without a completion score", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Open pre-launch overview/i }));

    expect(window.location.hash).toBe("#setup");
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    const identifier = screen.getByLabelText("Example identifier");
    fireEvent.change(identifier, { target: { value: `0x${"b".repeat(40)}` } });
    expect(screen.getByText("address")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume DuskEVM/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/0\/4/)).not.toBeInTheDocument();
  });

  it("keeps DuskEVM as one pre-launch learning surface and shows release identity", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    expect(screen.getByText("No live evidence is recorded")).toBeInTheDocument();
    expect(screen.getByText("https://rpc.testnet.evm.dusk.network")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy pre-launch RPC URL" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Official docs source/ })).toHaveAttribute("href", "https://github.com/dusk-network/docs");
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
    expect(screen.getAllByText(/reviewed July 20, 2026/).length).toBeGreaterThan(2);
    expect(screen.getAllByText("Pre-launch Testnet reference").length).toBeGreaterThan(0);
    expect(screen.getByText("pre-launch metadata")).toBeInTheDocument();
    expect(screen.getAllByText("reference only")).toHaveLength(2);
  });

  it("shows the complete selected-path capability set before a search", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#reference";
    render(<App />);

    expect(screen.getByRole("button", { name: "Show all 17 capabilities" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 17 capabilities" }));
    expect(screen.getByText("Citadel 2 private identity and access")).toBeInTheDocument();
    expect(screen.getByText("Deterministic and verifiable builds")).toBeInTheDocument();
  });

  it("keeps active DuskDS recovery separate from pre-launch EVM planning", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    expect(screen.getByRole("heading", { name: "Fix the blocker in front of you." })).toBeInTheDocument();
    expect(screen.getAllByText("Cause and fix").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recheck:").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Wallet is on the wrong chain" })).not.toBeInTheDocument();
  });

  it("keeps common recovery focused while making every reviewed issue reachable", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    expect(screen.getByRole("button", { name: "DuskDS common issues" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "Hedger is mentioned but not ready for Studio automation" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All reviewed issues" }));

    expect(screen.getByRole("button", { name: "All reviewed issues" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("45 reviewed entries found.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hedger is mentioned but not ready for Studio automation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wallet is on the wrong chain" })).toBeInTheDocument();
  });

  it("selects DuskDS before opening a recovery action from a pathless session", () => {
    window.location.hash = "#troubleshooting";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "deep path" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Build" }));

    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
    expect(window.location.hash).toBe("#build");
    expect(screen.getByRole("heading", { name: "Build contract and data-driver WASM together." })).toBeInTheDocument();
  });

  it("switches an opposite selected path before opening a DuskDS recovery action", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#troubleshooting";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "All reviewed issues" }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "deep path" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Build" }));

    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
    expect(window.location.hash).toBe("#build");
    expect(screen.getByRole("heading", { name: "Build contract and data-driver WASM together." })).toBeInTheDocument();
  });

  it("labels every EVM-only reviewed issue as pre-launch planning", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "All reviewed issues" }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Blockscout unavailable" } });
    const row = screen.getByRole("heading", { name: "Blockscout unavailable" }).closest("article");
    expect(row).toHaveTextContent("Planning");
    expect(row).toHaveTextContent("Review before launch:");
    expect(row).not.toHaveTextContent("Recheck:");
  });

  it("keeps a live DuskDS node outage in active recovery in both scopes", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "DuskDS public node check" } });
    let row = screen.getByRole("heading", { name: "DuskDS public node check is unavailable or slow" }).closest("article");
    expect(row).toHaveTextContent("Medium impact");
    expect(row).toHaveTextContent("Recheck:");
    expect(row).not.toHaveTextContent("Planning");

    fireEvent.click(screen.getByRole("button", { name: "All reviewed issues" }));
    row = screen.getByRole("heading", { name: "DuskDS public node check is unavailable or slow" }).closest("article");
    expect(row).toHaveTextContent("Medium impact");
    expect(row).toHaveTextContent("Recheck:");
    expect(row).not.toHaveTextContent("Review before launch:");
  });

  it("requires an inline confirmation before resetting browser-local progress", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");

    fireEvent.click(screen.getByRole("button", { name: "Build & browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
    expect(screen.getByText("Reset saved DuskDS journey progress in this browser?")).toBeInTheDocument();
    expect(screen.getByText(/Session-only page choices end when you close this tab/)).toBeInTheDocument();
    expect(screen.queryByText(/Reset all Studio progress/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset browser progress" })).toHaveFocus();
    const resetCancel = screen.getByRole("button", { name: "Cancel" });
    resetCancel.focus();
    expect(resetCancel).toHaveFocus();
    fireEvent.keyDown(resetCancel, { key: "Escape" });
    expect(screen.queryByText("Reset saved DuskDS journey progress in this browser?")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBe("duskds");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset browser progress" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
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

  it("does not resurrect a reset path through Back, Forward, or reload", async () => {
    const view = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    fireEvent.click(screen.getByRole("button", { name: "Build & browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset browser progress" }));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFor(() => expect(window.location.hash).toBe("#reference"));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();
    expect(screen.getByRole("button", { name: "All references" })).toHaveClass("active");

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFor(() => expect(window.location.hash).toBe("#settings"));
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();

    view.unmount();
    render(<App />);
    expect(window.localStorage.getItem("dusk-studio-builder-path")).toBeNull();
    expect(screen.getByRole("heading", { name: "See the build you are using and control its saved progress." })).toBeInTheDocument();
  });

  it("makes saved-progress review and clean-start recovery discoverable on the chooser", () => {
    const progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "setup",
      ["duskds-required-preflight"],
      { method: "automatic" }
    );
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    render(<App />);

    expect(screen.getByText("DuskDS progress saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review or reset saved progress" }));
    expect(window.location.hash).toBe("#settings");
    expect(screen.getByRole("heading", { name: "See the build you are using and control its saved progress." })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /Local Studio/i }));
    expect(screen.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue in the hosted guide" })).toBeInTheDocument();
    expect(screen.getByText(`npx dusk-developer-studio@${STUDIO_RELEASE.version}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review this package version and provenance/i })).toHaveAttribute(
      "href",
      `https://www.npmjs.com/package/dusk-developer-studio/v/${STUDIO_RELEASE.version}`
    );
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("keeps a hosted artifact in guide mode on loopback without making companion requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime("127.0.0.1", "hosted")} />);

    fireEvent.click(screen.getByRole("button", { name: /Local Studio/i }));
    expect(screen.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("bootstraps an npm same-origin session and requires exact release parity", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "pairing_required" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease })));
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#companion";
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Local Studio/i }));
    expect(screen.getByText("Paired. Local capabilities are enabled.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Local Studio is paired and ready." })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Local Studio is paired and ready. | Dusk Developer Studio"));
    expect(screen.queryByLabelText("Pairing token")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://" + window.location.hostname + ":8788/health",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      window.location.origin + "/__dusk/bootstrap",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://" + window.location.hostname + ":8788/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("blocks local actions when the companion release does not match", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "pairing_required" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: { ...npmRelease, commit: "b".repeat(40) } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: /Local Studio/i }));
    expect(screen.getByText(/release identities do not match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paths" }));
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    fireEvent.click(screen.getByRole("button", { name: /3 Build/i }));
    expect(screen.getByRole("button", { name: "Resolve local release mismatch" })).toBeInTheDocument();
  });

  it("reuses an existing npm companion session without spending the one-use bootstrap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        service: "dusk-studio-local-agent",
        paired: true,
        capabilitiesEnabled: true,
        release: npmRelease
      }))
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0]).endsWith(":8788/health")).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/__dusk/bootstrap"))).toBe(false);
  });

  it("waits through a delayed same-origin pair before checking health", async () => {
    let finishPair!: (response: Response) => void;
    const delayedPair = new Promise<Response>((resolve) => { finishPair = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "pairing_required" }), { status: 401 }))
      .mockReturnValueOnce(delayedPair)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        service: "dusk-studio-local-agent",
        paired: true,
        capabilitiesEnabled: true,
        release: npmRelease
      })));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      window.location.origin + "/__dusk/bootstrap",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    finishPair(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })));
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers a concurrent bootstrap through the session cookie or gives a restart instruction", async () => {
    const health = {
      ok: true,
      service: "dusk-studio-local-agent",
      paired: true,
      capabilitiesEnabled: true,
      release: npmRelease
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "pairing_required" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "bootstrap_in_progress" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(health)));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("explains how to restart after a genuinely expired npm launch", async () => {
    const unpaired = new Response(JSON.stringify({ ok: false, code: "pairing_required" }), { status: 401 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unpaired)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "bootstrap_expired" }), { status: 410 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: "pairing_required" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    fireEvent.click(await screen.findByRole("button", { name: /Local Studio/i }));
    expect(await screen.findByRole("heading", { name: "Local Studio is not paired." })).toBeInTheDocument();
    expect(screen.getByText(/already paired in another browser profile or its five-minute pairing window expired/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pair the browser profile you intend to use" })).toBeInTheDocument();
    expect(screen.getByText(`npx dusk-developer-studio@${npmRelease.version} --no-open`)).toBeInTheDocument();
    expect(screen.getByText(`npx dusk-developer-studio@${npmRelease.version} local-actions --no-open`)).toBeInTheDocument();
  });

  it("refuses automatic Setup evidence for an incompatible Windows wasm-opt shim", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/__dusk/bootstrap")) return new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 }));
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease }));
      if (url.includes("/preflight?path=duskds")) {
        return new Response(JSON.stringify({
          ok: false,
          checkedAt: "2026-07-19T00:00:00.000Z",
          path: "duskds",
          tools: [{
            name: "wasm-opt",
            command: "wasm-opt",
            ok: false,
            required: true,
            failureKind: "unsupported",
            error: "Check failed.",
            installHint: "Remove the incompatible shim or install native Binaryen."
          }]
        }));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#setup";
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run automatic preflight" }));

    await waitFor(() => expect(screen.getByText(/At least one required tool needs a specific fix/)).toBeInTheDocument());
    expect(screen.getByText(/Remove the incompatible shim or install native Binaryen/)).toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as {
        paths: { duskds: { setup: { blocker?: string; evidence: string[] } } };
      };
      expect(stored.paths.duskds.setup.blocker).toBe("toolchain-incomplete");
      expect(stored.paths.duskds.setup.evidence).toEqual([]);
    });
  });

  it("uses the successful scaffold's canonical path for follow-on commands without persisting it", async () => {
    const projectPath = "C:\\Users\\tester\\AppData\\Local\\Dusk\\DeveloperStudio\\projects\\duskds\\duskds-forge-starter";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/__dusk/bootstrap")) {
        return new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 }));
      }
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease }));
      }
      if (url.endsWith("/scaffold-duskds-forge")) {
        return new Response(JSON.stringify({
          ok: true,
          projectName: "duskds-forge-starter",
          projectPath,
          rustToolchain: "1.94.0",
          runtimeOs: "windows",
          structureVerified: true,
          files: ["Cargo.toml", "rust-toolchain.toml"],
          template: "duskds-counter-forge",
          templateSource: "https://github.com/dusk-network/forge",
          templateRevision: reviewedTemplateRevision,
          templateLockSha256: reviewedTemplateLock
        }));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";

    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Build commands appear after verified creation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Build contract + data-driver WASM" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));

    fireEvent.click(screen.getByRole("button", { name: "Create and verify DuskDS starter" }));

    await waitFor(() => expect(screen.getByText(projectPath, { selector: "code" })).toBeInTheDocument());
    expect(screen.getAllByText((content, element) => element?.tagName === "PRE"
      && content.includes(`Set-Location -LiteralPath '${projectPath}'`)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copy Build contract + data-driver WASM" })).toBeInTheDocument();
    const persistedValues = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.getItem(window.localStorage.key(index) ?? "")
    );
    expect(persistedValues.join("\n")).not.toContain(projectPath);

    fireEvent.change(screen.getByLabelText("Artifact source identity"), {
      target: { value: "d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a" }
    });
    const filenames = screen.getAllByLabelText("Filename");
    const hashes = screen.getAllByLabelText("SHA-256");
    const sizes = screen.getAllByLabelText("Size in bytes");
    fireEvent.change(filenames[0], { target: { value: "counter-contract.wasm" } });
    fireEvent.change(hashes[0], { target: { value: "a".repeat(64) } });
    fireEvent.change(sizes[0], { target: { value: "1234" } });
    fireEvent.change(filenames[1], { target: { value: "counter-data-driver.wasm" } });
    fireEvent.change(hashes[1], { target: { value: "b".repeat(64) } });
    fireEvent.change(sizes[1], { target: { value: "2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual artifact evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "I ran the reviewed WSL environment check successfully" }));
    fireEvent.click(screen.getByRole("button", { name: "I observed the VM test pass in this environment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save manual VM-test evidence" }));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as {
        paths: { duskds: { build: { evidenceEntries: Array<{ code: string; metadata?: { testEnvironment?: string } }> } } };
      };
      expect(stored.paths.duskds.build.evidenceEntries.find(
        (entry) => entry.code === "duskds-vm-test-attestation"
      )?.metadata?.testEnvironment).toBe("wsl-ubuntu-24.04");
    });

    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as {
        paths: { duskds: { build: { evidence: string[] } } };
      };
      expect(stored.paths.duskds.build.evidence).toEqual([]);
    });
    expect(screen.queryByText(projectPath)).not.toBeInTheDocument();
  });

  it("uses the companion-reported macOS runtime for automatic scaffold evidence", async () => {
    const projectPath = "/Users/tester/Library/Application Support/Dusk/DeveloperStudio/projects/duskds/duskds-forge-starter";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          ok: true,
          service: "dusk-studio-local-agent",
          paired: true,
          capabilitiesEnabled: true,
          release: npmRelease
        }));
      }
      if (url.endsWith("/scaffold-duskds-forge")) {
        return new Response(JSON.stringify(scaffoldReceipt(projectPath, false, "macos")));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create and verify DuskDS starter" }));
    await waitFor(() => expect(screen.getByText(projectPath, { selector: "code" })).toBeInTheDocument());
    expect(screen.getByText("macOS", { selector: ".command-context .status-pill" })).toBeInTheDocument();
    await waitFor(() => {
      const progress = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as {
        paths: { duskds: { build: { evidenceEntries: Array<{ code: string; metadata?: { platform?: string } }> } } };
      };
      expect(progress.paths.duskds.build.evidenceEntries.find(
        (entry) => entry.code === "duskds-starter-structure"
      )?.metadata?.platform).toBe("macos");
    });
  });

  it("rejects unsafe project names and paths before rendering commands", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";
    const { container } = render(<App />);
    const projectName = screen.getByLabelText("Project name");

    for (const invalid of [".", "..", "a..b", "demo.", "CON", "lpt1", "Native", "1demo", "demo_name", "demo--name", "demo-"]) {
      fireEvent.change(projectName, { target: { value: invalid } });
      expect(screen.getAllByRole("alert").some((alert) =>
        /Use 1–80 lowercase letters, numbers, or single hyphens/.test(alert.textContent ?? "")
      )).toBe(true);
      expect(screen.queryByRole("button", { name: "Copy Prepare project" })).not.toBeInTheDocument();
    }
    for (const keyword of ["type", "mod", "self", "crate", "super", "async", "await", "gen", "macro-rules"]) {
      fireEvent.change(projectName, { target: { value: keyword } });
      expect(screen.getAllByRole("alert").some((alert) =>
        /Rust 2024 keywords and reserved words/.test(alert.textContent ?? "")
      )).toBe(true);
      expect(screen.queryByRole("button", { name: "Copy Prepare project" })).not.toBeInTheDocument();
    }

    fireEvent.change(projectName, { target: { value: "safe-demo" } });
    fireEvent.click(screen.getByRole("button", { name: /Existing repository/ }));
    fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));
    const root = screen.getByLabelText("Existing project root");
    expect(screen.queryByText("Enter an absolute existing project root.")).not.toBeInTheDocument();
    expect(root).toHaveAttribute("aria-invalid", "false");
    fireEvent.blur(root);
    expect(screen.getByText("Enter an absolute existing project root.")).toHaveAttribute(
      "id",
      "existing-project-root-error"
    );
    expect(root).toHaveAttribute("aria-invalid", "true");
    expect(root).toHaveAttribute("aria-describedby", "existing-project-root-error");
    for (const invalid of ["\\root-relative", "/root-relative", "C:\\", "C:\\bad\0path"]) {
      fireEvent.change(root, { target: { value: invalid } });
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: "Copy Prepare project" })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    fireEvent.change(root, { target: { value: "/" } });
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Copy Prepare project" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Windows PowerShell" }));
    fireEvent.change(root, { target: { value: "C:\\work\r\nWrite-Host bad" } });
    expect(root).toHaveValue("C:\\workWrite-Host bad");
    expect(screen.getByRole("heading", { name: "Prepare project" }).parentElement?.querySelector("pre")?.textContent)
      .not.toContain("\nWrite-Host bad");

    fireEvent.change(root, { target: { value: "C:\\work\\safe-demo" } });
    expect(screen.getByRole("button", { name: "Copy Prepare project" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Linux shell" }));
    expect(screen.getAllByRole("alert").some((alert) =>
      /must be an absolute path/.test(alert.textContent ?? "")
    )).toBe(true);
    fireEvent.change(root, { target: { value: "/" } });
    expect(screen.getAllByRole("alert").some((alert) =>
      /cannot be a filesystem root/.test(alert.textContent ?? "")
    )).toBe(true);
    expect(container.textContent).not.toContain("\nWrite-Host bad");
  }, 10_000);

  it("locks scaffold context during an in-flight request and restores the exact receipt after SPA navigation", async () => {
    const projectPath = "C:\\Users\\tester\\AppData\\Local\\Dusk\\DeveloperStudio\\projects\\duskds\\duskds-forge-starter";
    let resolveScaffold!: (response: Response) => void;
    const deferredScaffold = new Promise<Response>((resolve) => {
      resolveScaffold = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/__dusk/bootstrap")) return new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 }));
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease }));
      if (url.endsWith("/scaffold-duskds-forge")) return deferredScaffold;
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Create and verify DuskDS starter" }));
    expect(screen.getByLabelText("Project name")).toBeDisabled();
    expect(screen.getByLabelText("Subfolder inside managed DuskDS root, optional")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Windows PowerShell" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Manual now/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /2 Access/i }));
    await act(async () => {
      resolveScaffold(new Response(JSON.stringify(scaffoldReceipt(projectPath))));
      await deferredScaffold;
    });
    await waitFor(() => expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").toContain("duskds-starter-structure"));
    fireEvent.click(screen.getByRole("button", { name: /3 Build/i }));

    await waitFor(() => expect(screen.getByText(projectPath, { selector: "code" })).toBeInTheDocument());
    expect(screen.getAllByText((content, element) => element?.tagName === "PRE"
      && content.includes(`Set-Location -LiteralPath '${projectPath}' -ErrorAction Stop`)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
  });

  it("forgets the canonical path on refresh without deleting durable Build evidence", async () => {
    const projectPath = "C:\\Users\\tester\\AppData\\Local\\Dusk\\DeveloperStudio\\projects\\duskds\\duskds-forge-starter";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/__dusk/bootstrap")) return new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 }));
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease }));
      if (url.endsWith("/scaffold-duskds-forge")) return new Response(JSON.stringify(scaffoldReceipt(projectPath)));
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    const view = render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create and verify DuskDS starter" }));
    await waitFor(() => expect(screen.getByText(projectPath, { selector: "code" })).toBeInTheDocument());
    window.dispatchEvent(new Event("beforeunload"));
    view.unmount();
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);

    await waitFor(() => expect(screen.getByText(/private project path was intentionally not retained after refresh/)).toBeInTheDocument());
    expect(screen.queryByText(projectPath)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").toContain("duskds-starter-structure");
    expect(window.sessionStorage.getItem("dusk-studio-duskds-scaffold-context")).toBeNull();
  });

  it("offers an explicit same-request recovery after the scaffold browser timeout", async () => {
    const projectPath = "C:\\Users\\tester\\AppData\\Local\\Dusk\\DeveloperStudio\\projects\\duskds\\duskds-forge-starter";
    let scaffoldCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/__dusk/bootstrap")) return new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 }));
      if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease }));
      if (url.endsWith("/scaffold-duskds-forge")) {
        scaffoldCalls += 1;
        if (scaffoldCalls === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true }
            );
          });
        }
        return new Response(JSON.stringify(scaffoldReceipt(projectPath, true)));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progressThroughDuskDsAccess()));
    window.location.hash = "#build";
    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Create and verify DuskDS starter" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(330_001);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByText(/browser wait ended.*recover a content-verified completed target/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(/Recovered the existing starter/)).toBeInTheDocument());
    expect(scaffoldCalls).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Manual now/ }));
  });

  it("shows a containment error and emits no commands or blocker for a rejected scaffold parent", async () => {
    const rejectedPath = "C:\\Windows";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/__dusk/bootstrap")) {
        return new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 }));
      }
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: true, release: npmRelease }));
      }
      if (url.endsWith("/scaffold-duskds-forge")) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Parent folder must stay inside the managed DuskDS project root.",
          code: "scaffold_parent_outside_root"
        }), { status: 422 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#build";

    render(<App runtime={getStudioRuntime(window.location.hostname, "npm")} release={npmRelease} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Local Studio: Actions ready/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Subfolder inside managed DuskDS root, optional"), { target: { value: rejectedPath } });
    fireEvent.click(screen.getByRole("button", { name: "Create and verify DuskDS starter" }));

    await waitFor(() => expect(screen.getByText(/must be a relative subfolder inside the managed DuskDS root/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Copy Build contract + data-driver WASM" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Build commands appear after verified creation" })).toBeInTheDocument();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("companion-unavailable");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/scaffold-duskds-forge"))).toBe(false);
    expect(document.body.textContent).not.toContain(`Set-Location -LiteralPath '${rejectedPath}'`);
  });
});
