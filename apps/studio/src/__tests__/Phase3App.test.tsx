import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";

describe("Phase 3 interaction semantics", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = "";
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  });

  it("keeps path choice on the overview and step navigation inside the selected journey", () => {
    render(<App />);

    expect(screen.queryByLabelText("Builder path selector")).not.toBeInTheDocument();
    const globalNavigation = screen.getByLabelText("Studio navigation");
    expect(within(globalNavigation).getByRole("button", { name: "Paths" })).toBeInTheDocument();
    expect(within(globalNavigation).getByRole("button", { name: "Reference" })).toBeInTheDocument();
    expect(within(globalNavigation).getByRole("button", { name: "Troubleshoot" })).toBeInTheDocument();
    expect(within(globalNavigation).getByRole("button", { name: /Local Studio/i })).toBeInTheDocument();
    expect(within(globalNavigation).queryByRole("button", { name: /Setup|Access|Build|Inspect/i })).not.toBeInTheDocument();

    const evmPath = screen.getByRole("button", { name: /Open pre-launch overview/i });
    const nativePath = screen.getByRole("button", { name: /Start DuskDS/i });
    expect(evmPath).toHaveAccessibleName("DuskEVM. Open pre-launch overview");
    expect(evmPath).toHaveAccessibleDescription(/Explore one source-backed pre-launch reference/);
    expect(evmPath).toHaveAccessibleDescription(/does not provide a completion score/);
    expect(nativePath).toHaveAccessibleName("DuskDS. Start DuskDS");
    expect(nativePath).toHaveAccessibleDescription(/Follow every step manually, or run the Local Studio with npm/);
    expect(evmPath).not.toHaveAttribute("aria-pressed");
    expect(nativePath).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("table", { name: "Quick comparison of the two Dusk builder paths" })).toBeInTheDocument();

    fireEvent.click(nativePath);
    expect(screen.queryByRole("button", { name: "Resume DuskDS at Setup" })).not.toBeInTheDocument();
    expect(within(globalNavigation).queryByRole("button", { name: /Setup|Access|Build|Inspect/i })).not.toBeInTheDocument();

    const guideNavigation = screen.getByLabelText("DuskDS guide sequence");
    expect(within(guideNavigation).getByRole("button", { name: /1 Setup/i })).toHaveAttribute("aria-current", "step");
    expect(within(guideNavigation).getByRole("button", { name: /2 Access/i })).toBeInTheDocument();

    fireEvent.click(within(globalNavigation).getByRole("button", { name: "Reference" }));
    expect(screen.getByRole("button", { name: "Return to DuskDS at Setup" })).toBeInTheDocument();
    const pathFilter = screen.getByRole("button", { name: "DuskDS only" });
    const allFilter = screen.getByRole("button", { name: "All references" });
    expect(pathFilter).toHaveAttribute("aria-pressed", "true");
    expect(allFilter).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("heading", { name: /DuskEVM network metadata/i })).not.toBeInTheDocument();
    fireEvent.click(allFilter);
    expect(pathFilter).toHaveAttribute("aria-pressed", "false");
    expect(allFilter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: /DuskEVM network metadata/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show all \d+ docs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show all \d+ capabilities/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show all \d+ docs/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Show all \d+ docs/i })).toHaveAttribute("aria-controls", "reference-docs-results");
    expect(screen.getByRole("button", { name: /Show all \d+ capabilities/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Show all \d+ capabilities/i })).toHaveAttribute("aria-controls", "reference-capability-results");
    fireEvent.click(screen.getByRole("button", { name: /Show all \d+ docs/i }));
    expect(screen.getByRole("button", { name: "Show fewer docs" })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps keyboard focus and announces results after broadening an empty reference search", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reference" }));

    const search = screen.getByPlaceholderText(/Search docs, capabilities/i);
    expect(screen.getByRole("link", { name: /Open the official docs source/ })).toHaveAttribute(
      "href",
      "https://github.com/dusk-network/docs"
    );
    fireEvent.change(search, { target: { value: "agent-pilot-deliberate-empty-query" } });
    const clear = screen.getByRole("button", { name: "Clear search" });
    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue("");
    expect(
      screen.getByText("Search cleared. References in the current scope restored.")
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Hedger" } });
    const broaden = screen.getByRole("button", { name: "Search all references" });
    broaden.focus();
    fireEvent.click(broaden);

    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByText("Search expanded to all reviewed references. Results updated.")).toBeInTheDocument();
    expect(screen.getByText("Hedger Confidential EVM Route Mention")).toBeInTheDocument();
  });

  it("announces ordinary Reference search recovery counts", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#reference";
    render(<App />);

    const search = screen.getByPlaceholderText(/Search docs, capabilities/i);
    search.focus();
    fireEvent.change(search, { target: { value: "zzzz-no-result" } });
    await waitFor(() => expect(screen.getByText("0 documents, 0 capabilities, and 0 network records found.")).toBeInTheDocument());

    fireEvent.change(search, { target: { value: "W3sper" } });
    await waitFor(() => expect(screen.getByText("1 document, 5 capabilities, and 0 network records found.")).toBeInTheDocument());
    expect(search).toHaveFocus();
  });

  it("returns focus to Troubleshooting search after clearing an empty result", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    const search = screen.getByPlaceholderText(/Search Forge, Rust, WASM/i);
    fireEvent.change(search, { target: { value: "zzzz-no-such-fix" } });
    expect(screen.getByText("0 recovery entries found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open project support/ })).toHaveAttribute(
      "href",
      "https://github.com/GeorgianDusk/dusk-developer-studio/issues"
    );

    const clear = screen.getByRole("button", { name: "Clear search" });
    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue("");
    expect(screen.getByText(/recovery entries found\./)).toBeInTheDocument();
  });

  it("moves focus into the manual lane when a dynamic Local Studio panel is removed", async () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#setup";
    render(<App />);

    let methodPicker = screen.getByRole("group", { name: "Choose how to complete this task" });
    fireEvent.click(within(methodPicker).getByRole("button", { name: /Local Studio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue manually" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Run the required checks yourself" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: /3 Build/ }));
    methodPicker = screen.getByRole("group", { name: "Choose how to complete this task" });
    fireEvent.click(within(methodPicker).getByRole("button", { name: /Local Studio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue manually" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Create the reviewed starter" })).toHaveFocus());
  });

  it("returns from DuskEVM support routes to the pre-launch overview", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Open pre-launch overview/i }));
    expect(window.location.hash).toBe("#evm/setup");

    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    const returnToOverview = screen.getByRole("button", { name: "Return to DuskEVM pre-launch overview" });
    expect(returnToOverview).toHaveTextContent("Return to pre-launch overview");
    fireEvent.click(returnToOverview);

    expect(window.location.hash).toBe("#evm/setup");
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    expect(screen.getByLabelText("Example identifier")).toBeInTheDocument();
  });

  it("provides direct focusable navigation across the long Inspect page", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#inspect";
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "4. Data driver" }));
    expect(screen.getByRole("heading", { name: "4. Return after deployment and inspect the data driver" }).closest(".focus-card")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "1. Latest block" }));
    expect(screen.getByRole("heading", { name: "1. Observe a latest block" }).closest(".focus-card")).toHaveFocus();
  });

  it("keeps DuskEVM troubleshooting actions truthful during pre-launch", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.location.hash = "#troubleshooting";
    render(<App />);

    expect(screen.getByText(/There is no DuskEVM RPC health check to retry in Studio before launch/)).toBeInTheDocument();
    expect(screen.getByText(/No wallet action is required in Studio before launch/)).toBeInTheDocument();
    expect(screen.getByText(/Funding is not active in Studio before launch/)).toBeInTheDocument();
    expect(screen.getByText(/Foundry is not required for the current pre-launch reference/)).toBeInTheDocument();
    expect(screen.getByText(/Studio does not submit DuskEVM verification before launch/)).toBeInTheDocument();
    expect(screen.queryByText(/Retry the RPC health check/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Install or unlock an EIP-1193 compatible wallet/)).not.toBeInTheDocument();
  });

  it("canonicalizes unsupported and DuskEVM-only guide hashes to the rendered surface", async () => {
    window.location.hash = "#not-a-route";
    const firstRender = render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#overview"));
    expect(screen.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeInTheDocument();
    firstRender.unmount();

    window.localStorage.setItem("dusk-studio-builder-path", "evm");
    window.history.replaceState({}, "", "#overview");
    window.history.pushState({}, "", "#build");
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe("#evm/setup"));
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFor(() => expect(window.location.hash).toBe("#overview"));
    expect(screen.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeInTheDocument();

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFor(() => expect(window.location.hash).toBe("#evm/setup"));
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
  });

  it("finds the bounded recovery path when browser security blocks the public node check", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "CSP" } });

    expect(screen.getByRole("heading", { name: "Browser blocks the public Dusk node check" })).toBeInTheDocument();
    expect(screen.getByText(/exact current npm package shown on Studio's Local Studio page/)).toBeInTheDocument();
    expect(screen.getByText(/Do not weaken browser security or add CSP, certificate, or network exceptions/)).toBeInTheDocument();
  });

  it("recognizes the exact missing Ubuntu WSL failure and routes back to Setup", () => {
    window.localStorage.setItem("dusk-studio-builder-path", "duskds");
    window.location.hash = "#troubleshooting";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "WSL_E_DISTRO_NOT_FOUND" } });

    expect(screen.getByRole("heading", { name: "dusk-forge test needs a Linux environment" })).toBeInTheDocument();
    expect(screen.getByText(/wsl --install -d Ubuntu-24\.04/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy fix command for dusk-forge test needs a Linux environment/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Setup" })).toBeInTheDocument();
  });
});
