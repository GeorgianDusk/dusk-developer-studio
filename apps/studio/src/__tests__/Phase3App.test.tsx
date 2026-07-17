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
    expect(within(globalNavigation).getByRole("button", { name: /Local runtime/i })).toBeInTheDocument();
    expect(within(globalNavigation).queryByRole("button", { name: /Setup|Access|Build|Inspect/i })).not.toBeInTheDocument();

    const evmPath = screen.getByRole("button", { name: /Start Solidity path/i });
    const nativePath = screen.getByRole("button", { name: /Start native path/i });
    expect(evmPath).toHaveAccessibleName("DuskEVM. Start Solidity path");
    expect(evmPath).toHaveAccessibleDescription(/Choose this to learn the planned Solidity/);
    expect(evmPath).toHaveAccessibleDescription(/Live Testnet evidence remains deferred/);
    expect(nativePath).toHaveAccessibleName("DuskDS. Start native path");
    expect(nativePath).toHaveAccessibleDescription(/Local machine actions require the portable companion/);
    expect(evmPath).not.toHaveAttribute("aria-pressed");
    expect(nativePath).not.toHaveAttribute("aria-pressed");
    expect(screen.getByRole("table", { name: "Quick comparison of the two Dusk builder paths" })).toBeInTheDocument();

    fireEvent.click(nativePath);
    expect(screen.getByLabelText("Current journey")).toHaveTextContent("DuskDS journey");
    expect(within(globalNavigation).queryByRole("button", { name: /Setup|Access|Build|Inspect/i })).not.toBeInTheDocument();

    const guideNavigation = screen.getByLabelText("DuskDS guide sequence");
    expect(within(guideNavigation).getByRole("button", { name: /1 Setup/i })).toHaveAttribute("aria-current", "step");
    expect(within(guideNavigation).getByRole("button", { name: /2 Access/i })).toBeInTheDocument();

    fireEvent.click(within(globalNavigation).getByRole("button", { name: "Reference" }));
    const pathFilter = screen.getByRole("button", { name: "DuskDS only" });
    const allFilter = screen.getByRole("button", { name: "All references" });
    expect(pathFilter).toHaveAttribute("aria-pressed", "true");
    expect(allFilter).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(allFilter);
    expect(pathFilter).toHaveAttribute("aria-pressed", "false");
    expect(allFilter).toHaveAttribute("aria-pressed", "true");
  });
});
