import { describe, expect, it } from "vitest";
import { STUDIO_PRODUCT, type StudioRelease } from "../release";
import { getStudioRuntime, hasPortableReleaseParity } from "./runtime";

describe("Studio runtime mode", () => {
  it.each(["127.0.0.1", "localhost"])("allows explicit portable and source channels on IPv4 loopback host %s", (hostname) => {
    expect(getStudioRuntime(hostname, "portable")).toMatchObject({ mode: "local-capable", companionAvailable: true, channel: "portable" });
    expect(getStudioRuntime(hostname, "source-dev")).toMatchObject({ mode: "hosted-docs-only", companionAvailable: false, channel: "source-dev" });
  });

  it.each(["127.0.0.1", "localhost", "example.org", "::1", "[::1]"])("keeps the hosted artifact docs-only on %s", (hostname) => {
    expect(getStudioRuntime(hostname, "hosted")).toEqual({
      mode: "hosted-docs-only",
      companionAvailable: false,
      label: "Docs-only",
      channel: "hosted"
    });
  });

  it.each(["::1", "[::1]", "example.org"])("refuses local capability on unsupported host %s", (hostname) => {
    expect(getStudioRuntime(hostname, "portable").companionAvailable).toBe(false);
    expect(getStudioRuntime(hostname, "source-dev").companionAvailable).toBe(false);
  });

  it("requires exact portable release parity with full commits", () => {
    const commit = "a".repeat(40);
    const frontend: StudioRelease = { product: STUDIO_PRODUCT, version: "1.2.3", commit, channel: "portable" };
    expect(hasPortableReleaseParity(frontend, { product: STUDIO_PRODUCT, version: "1.2.3", commit, channel: "portable" })).toBe(true);
    expect(hasPortableReleaseParity(frontend, { product: STUDIO_PRODUCT, version: "1.2.4", commit, channel: "portable" })).toBe(false);
    expect(hasPortableReleaseParity(frontend, { product: STUDIO_PRODUCT, version: "1.2.3", commit: commit.slice(0, 8), channel: "portable" })).toBe(false);
    expect(hasPortableReleaseParity({ ...frontend, channel: "source-dev" }, { product: STUDIO_PRODUCT, version: "1.2.3", commit, channel: "portable" })).toBe(false);
  });
});
