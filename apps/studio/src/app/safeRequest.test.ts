import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./safeRequest";

const isOk = (value: unknown): value is { ok: true } => Boolean(value) && typeof value === "object" && (value as { ok?: unknown }).ok === true;

describe("safe request boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns validated JSON inside the byte limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}')));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk, maxBytes: 64 })).resolves.toEqual({ ok: true });
  });

  it("rejects malformed and schema-invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":"yes"}')));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk })).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("rejects declared and streamed oversized bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-length": "100" } })));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk, maxBytes: 32 })).rejects.toMatchObject({ kind: "oversized-response" });
  });

  it("distinguishes timeout from caller cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk, timeoutMs: 5 })).rejects.toMatchObject({ kind: "timeout" });
    const controller = new AbortController();
    const request = requestJson("http://127.0.0.1/test", { validate: isOk, signal: controller.signal, timeoutMs: 1_000 });
    controller.abort();
    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
  });
});
