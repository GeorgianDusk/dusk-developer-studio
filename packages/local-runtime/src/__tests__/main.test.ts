// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolvePortableRuntimeCliMode } from "../main";

describe("portable runtime CLI mode", () => {
  it("defaults to safe interactive mode", () => {
    expect(resolvePortableRuntimeCliMode([])).toEqual({ capabilitiesEnabled: false, openBrowser: true, signedRcSelfTest: false });
  });

  it("forces a browser-free safe mode for signed-RC verification", () => {
    expect(resolvePortableRuntimeCliMode(["--signed-rc-self-test"])).toEqual({ capabilitiesEnabled: false, openBrowser: false, signedRcSelfTest: true });
    expect(resolvePortableRuntimeCliMode(["--signed-rc-self-test", "--no-open"])).toEqual({ capabilitiesEnabled: false, openBrowser: false, signedRcSelfTest: true });
  });

  it("rejects unknown, repeated, and capability-enabling self-test arguments", () => {
    expect(() => resolvePortableRuntimeCliMode(["--unknown"])).toThrow(/Unsupported argument/);
    expect(() => resolvePortableRuntimeCliMode(["--no-open", "--no-open"])).toThrow(/must not be repeated/);
    expect(() => resolvePortableRuntimeCliMode(["--signed-rc-self-test", "--enable-local-actions"])).toThrow(/cannot enable local machine actions/);
  });
});
