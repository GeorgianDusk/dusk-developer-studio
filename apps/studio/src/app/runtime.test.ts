import { describe, expect, it } from "vitest";
import { STUDIO_PRODUCT, type StudioRelease } from "../release";
import { getStudioRuntime, hasLocalReleaseParity } from "./runtime";

describe("Studio runtime mode", () => {
  it.each(["127.0.0.1", "localhost"])("allows the npm channel on IPv4 loopback host %s", (hostname) => {
    expect(getStudioRuntime(hostname, "npm")).toMatchObject({ mode: "local-capable", companionAvailable: true, channel: "npm" });
    expect(getStudioRuntime(hostname, "source-dev")).toMatchObject({ mode: "hosted-guide", companionAvailable: false, channel: "source-dev" });
  });

  it.each(["127.0.0.1", "localhost", "example.org", "::1", "[::1]"])("keeps the hosted artifact in guide mode on %s", (hostname) => {
    expect(getStudioRuntime(hostname, "hosted")).toEqual({
      mode: "hosted-guide",
      companionAvailable: false,
      label: "Hosted guide",
      channel: "hosted"
    });
  });

  it.each(["::1", "[::1]", "example.org"])("refuses local capability on unsupported host %s", (hostname) => {
    expect(getStudioRuntime(hostname, "npm").companionAvailable).toBe(false);
    expect(getStudioRuntime(hostname, "source-dev").companionAvailable).toBe(false);
  });

  it("requires exact npm release parity with full commits", () => {
    const commit = "a".repeat(40);
    const frontend: StudioRelease = { product: STUDIO_PRODUCT, version: "1.2.3", commit, channel: "npm" };
    expect(hasLocalReleaseParity(frontend, { product: STUDIO_PRODUCT, version: "1.2.3", commit, channel: "npm" })).toBe(true);
    expect(hasLocalReleaseParity(frontend, { product: STUDIO_PRODUCT, version: "1.2.4", commit, channel: "npm" })).toBe(false);
    expect(hasLocalReleaseParity(frontend, { product: STUDIO_PRODUCT, version: "1.2.3", commit: commit.slice(0, 8), channel: "npm" })).toBe(false);
    expect(hasLocalReleaseParity({ ...frontend, channel: "source-dev" }, { product: STUDIO_PRODUCT, version: "1.2.3", commit, channel: "npm" })).toBe(false);
  });
});
