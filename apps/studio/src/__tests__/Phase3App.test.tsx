import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";

describe("Phase 3 interaction semantics", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    expect(within(globalNavigation).getByRole("button", { name: /Automation/i })).toBeInTheDocument();
    expect(within(globalNavigation).queryByRole("button", { name: /Setup|Access|Build|Inspect/i })).not.toBeInTheDocument();

    const evmPath = screen.getByRole("button", { name: /Explore pre-launch reference/i });
    const nativePath = screen.getByRole("button", { name: /Start DuskDS/i });
    expect(evmPath).toHaveAccessibleName("DuskEVM. Explore pre-launch reference");
    expect(evmPath).toHaveAccessibleDescription(/Explore one source-backed pre-launch reference/);
    expect(evmPath).toHaveAccessibleDescription(/does not provide a completion score/);
    expect(nativePath).toHaveAccessibleName("DuskDS. Start DuskDS");
    expect(nativePath).toHaveAccessibleDescription(/Follow every step manually, or run the Local Studio with npm/);
    expect(evmPath).not.toHaveAttribute("aria-pressed");
    expect(nativePath).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("table", { name: "Quick comparison of the two Dusk builder paths" })).toBeInTheDocument();

    fireEvent.click(nativePath);
    expect(screen.getByRole("button", { name: "Resume DuskDS at Setup" })).toHaveTextContent("0/4 complete · 0 automatic · 0 manual");
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
});
