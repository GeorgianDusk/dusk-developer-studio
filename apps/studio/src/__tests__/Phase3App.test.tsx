import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  });

  it("keeps keyboard focus and announces results after broadening an empty reference search", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Start DuskDS/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reference" }));

    const search = screen.getByPlaceholderText(/Search docs, capabilities/i);
    fireEvent.change(search, { target: { value: "Hedger" } });
    const broaden = screen.getByRole("button", { name: "Search all references" });
    broaden.focus();
    fireEvent.click(broaden);

    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByText("Search expanded to all reviewed references. Results updated.")).toBeInTheDocument();
    expect(screen.getByText("Hedger Confidential EVM Route Mention")).toBeInTheDocument();
  });

  it("returns from DuskEVM support routes to the pre-launch overview", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Open pre-launch overview/i }));
    expect(window.location.hash).toBe("#setup");

    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    const returnToOverview = screen.getByRole("button", { name: "Return to DuskEVM pre-launch overview" });
    expect(returnToOverview).toHaveTextContent("Return to pre-launch overview");
    fireEvent.click(returnToOverview);

    expect(window.location.hash).toBe("#setup");
    expect(screen.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeInTheDocument();
    expect(screen.getByLabelText("Example identifier")).toBeInTheDocument();
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
});
