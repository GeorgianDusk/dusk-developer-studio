import { describe, expect, it } from "vitest";
import { readBoundedJson } from "../index";

describe("bounded JSON reader", () => {
  it("parses a response inside the configured byte bound", async () => {
    await expect(readBoundedJson(new Response(JSON.stringify({ ok: true })), 64)).resolves.toEqual({ ok: true });
  });

  it("rejects a declared oversized response before reading the body", async () => {
    const response = new Response("{}", { headers: { "content-length": "4097" } });
    await expect(readBoundedJson(response, 4096)).rejects.toMatchObject({ kind: "oversized-response" });
  });

  it("rejects a streamed response that crosses the bound", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new Uint8Array(128));
        controller.close();
      }
    });
    await expect(readBoundedJson(new Response(stream), 32)).rejects.toMatchObject({ kind: "oversized-response" });
  });

  it("rejects malformed JSON without exposing its content", async () => {
    await expect(readBoundedJson(new Response("{secret"), 64)).rejects.toMatchObject({ kind: "invalid-json" });
  });
});
