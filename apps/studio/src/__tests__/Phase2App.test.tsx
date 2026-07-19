import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { createInitialJourneyProgress, JOURNEY_PROGRESS_STORAGE_KEY, recordJourneyEvidence } from "../app/journeyProgress";

describe("Phase 2 evidence journeys", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = "";
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "ethereum", { value: undefined, configurable: true, writable: true });
  });

  it("keeps the DuskEVM surface informational during pre-launch", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#setup";
    const provider = {
      request: vi.fn()
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    render(<App />);

    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    expect(screen.getByText("No live evidence is recorded")).toBeInTheDocument();
    expect(screen.queryByText(/0\/4/)).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Example identifier"), { target: { value: address } });
    expect(screen.getByText("address")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "").not.toContain("evm-read-inspection");
  });

  it("exposes invalid Inspect input through the field description", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#inspect";
    render(<App />);

    const input = screen.getByLabelText("Example identifier");
    fireEvent.change(input, { target: { value: "not-an-identifier" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Unrecognized shape/);
  });

  it("requires bounded manual values before recording a terminal observation", async () => {
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
    expect(screen.getByText("Ready", { selector: ".done-panel .status-pill" })).toBeInTheDocument();
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
    expect(window.location.hash).toBe("#reference");
    expect(screen.getByRole("button", { name: "Return to DuskDS at Inspect" })).toHaveTextContent("4/4 complete");
  });

  it("rejects an Inspect source identity that does not match Build", () => {
    const revision = "a".repeat(40);
    let progress = recordJourneyEvidence(
      createInitialJourneyProgress(),
      "duskds",
      "build",
      ["duskds-starter-structure", "duskds-build-artifact-attestation", "duskds-vm-test-attestation"],
      { metadata: { revision } }
    );
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: "b".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Save source match" }));

    expect(screen.getByRole("alert")).toHaveTextContent("same source identity recorded for both Build artifacts and the VM test");
    progress = JSON.parse(window.localStorage.getItem(JOURNEY_PROGRESS_STORAGE_KEY) ?? "{}") as typeof progress;
    expect(progress.paths.duskds.inspect.evidence).not.toContain("duskds-inspect-artifact-revision");
  });

  it("requires matching contract metadata before accepting driver observations", async () => {
    const revision = "a".repeat(40);
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
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.localStorage.setItem(JOURNEY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Artifact source identity"), { target: { value: revision } });
    fireEvent.change(screen.getByLabelText("Deployed contract ID"), { target: { value: "b".repeat(64) } });
    expect(screen.getByText(/cat metadata-response\.bin/)).toBeInTheDocument();
    expect(screen.getByText(/Get-Content -Raw -LiteralPath '.\\metadata-response\.bin'/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toBeDisabled();
    expect(screen.getByLabelText("Schema response SHA-256")).toBeDisabled();
    expect(screen.queryByText(/\/on\/driver:<contract_id>\/get_schema/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "I observed driver_available: true in contract metadata" }));
    fireEvent.change(screen.getByLabelText("Metadata response SHA-256"), { target: { value: "d".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability confirmation" }));
    expect(await screen.findAllByText(/\/on\/driver:<contract_id>\/get_schema/)).toHaveLength(2);
    expect(screen.getByText(/cat schema-response\.bin/)).toBeInTheDocument();
    expect(screen.getByText(/Get-Content -Raw -LiteralPath '.\\schema-response\.bin'/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I observed a non-empty schema" })).toBeEnabled();
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

    expect(window.location.hash).toBe("#troubleshooting");
    const heading = await screen.findByRole("heading", { name: "The deployed contract's data driver is unavailable" });
    await waitFor(() => expect(heading.closest("article")).toHaveFocus());
    expect(screen.getByText("1 recovery entry found.")).toBeInTheDocument();
  });
});
