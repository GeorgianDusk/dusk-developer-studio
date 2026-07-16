import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_PRODUCT, type StudioRelease } from "../release";
import { App } from "../app/App";
import { getStudioRuntime } from "../app/runtime";

const portableRelease: StudioRelease = { product: STUDIO_PRODUCT, version: "1.2.3", commit: "a".repeat(40), channel: "portable" };

describe("Phase 4 controlled failures", () => {
  beforeEach(() => {
    window.location.hash = "";
    window.localStorage.clear();
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects malformed companion health without rendering attacker content", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "<img src=x onerror=secret>", paired: true, capabilitiesEnabled: "yes" }))));
    render(<App runtime={getStudioRuntime(window.location.hostname, "portable")} release={portableRelease} />);
    fireEvent.click(screen.getByRole("button", { name: /Local runtime/i }));
    await waitFor(() => expect(screen.getByText("The local companion returned data this Studio cannot safely use.")).toBeInTheDocument());
    expect(screen.queryByText(/onerror=secret/)).not.toBeInTheDocument();
  });

  it("routes capability-disabled sessions to explicit enablement", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true, expiresInSeconds: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: false, release: portableRelease })));
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#companion";
    render(<App runtime={getStudioRuntime(window.location.hostname, "portable")} release={portableRelease} />);
    await waitFor(() => expect(screen.getByText("Paired. Local capabilities are disabled until explicitly enabled.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Paths" }));
    fireEvent.click(screen.getByRole("button", { name: /Start Solidity path/i }));
    fireEvent.click(within(screen.getByLabelText("DuskEVM guide sequence")).getByRole("button", { name: /3 Build/i }));
    expect(screen.getByRole("button", { name: "Enable local capabilities" })).toBeInTheDocument();
  });
});
