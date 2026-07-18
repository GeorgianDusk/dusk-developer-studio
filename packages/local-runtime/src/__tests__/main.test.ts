// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseWindowsNetstatListeningEndpoints, resolvePortableRuntimeCliMode } from "../main";

describe("portable runtime CLI mode", () => {
  it("defaults to safe interactive mode", () => {
    expect(resolvePortableRuntimeCliMode([])).toEqual({ capabilitiesEnabled: false, openBrowser: true, signedRcSelfTest: false });
  });

  it("forces a browser-free safe mode for signed-RC verification", () => {
    expect(resolvePortableRuntimeCliMode(["--signed-rc-self-test"])).toEqual({ capabilitiesEnabled: false, openBrowser: false, signedRcSelfTest: true });
    expect(resolvePortableRuntimeCliMode(["--signed-rc-self-test", "--no-open"])).toEqual({ capabilitiesEnabled: false, openBrowser: false, signedRcSelfTest: true });
  });

  it("rejects unknown and repeated arguments while allowing the mode-bound actions launcher to self-test", () => {
    expect(() => resolvePortableRuntimeCliMode(["--unknown"])).toThrow(/Unsupported argument/);
    expect(() => resolvePortableRuntimeCliMode(["--no-open", "--no-open"])).toThrow(/must not be repeated/);
    expect(resolvePortableRuntimeCliMode(["--signed-rc-self-test", "--enable-local-actions"])).toEqual({
      capabilitiesEnabled: true,
      openBrowser: false,
      signedRcSelfTest: true
    });
  });

  it("parses locale-independent Windows netstat listener rows for the exact owner", () => {
    const output = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:8788         0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:53000        203.0.113.5:443         ESTABLISHED     4242",
      "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900"
    ].join("\r\n");
    expect(parseWindowsNetstatListeningEndpoints(output, 4242)).toEqual([
      "127.0.0.1:5173",
      "127.0.0.1:8788"
    ]);
    expect(() => parseWindowsNetstatListeningEndpoints("TCP broken", 4242)).toThrow(
      /malformed Windows socket row/
    );
    expect(() => parseWindowsNetstatListeningEndpoints(
      "TCP 127.0.0.1:5173 0.0.0.0:0 LISTENING 999999999999",
      4242
    )).toThrow(/malformed Windows socket PID/);
  });
});
