import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioErrorBoundary } from "./ErrorBoundary";

function ConditionalFailure() {
  if (window.location.hash !== "#overview") throw new Error("secret render detail");
  return <p>Recovered route</p>;
}

describe("Studio error boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a sanitized recovery screen and returns to the overview", () => {
    window.location.hash = "#setup";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<StudioErrorBoundary><ConditionalFailure /></StudioErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This route could not be shown safely");
    expect(screen.queryByText("secret render detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to paths" }));
    expect(screen.getByText("Recovered route")).toBeInTheDocument();
  });
});
