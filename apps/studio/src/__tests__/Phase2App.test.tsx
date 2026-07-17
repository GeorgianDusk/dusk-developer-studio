import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { createInitialJourneyProgress, JOURNEY_PROGRESS_STORAGE_KEY, recordJourneyEvidence } from "../app/journeyProgress";

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
});
