import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANION_SESSION_LOST_EVENT, LOCAL_ACTION_TIMEOUT_MS, requestJson } from "./safeRequest";

const isOk = (value: unknown): value is { ok: true } => Boolean(value) && typeof value === "object" && (value as { ok?: unknown }).ok === true;

describe("safe request boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns validated JSON inside the byte limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}')));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk, maxBytes: 64 })).resolves.toEqual({ ok: true });
  });

  it("keeps machine-action waits above their backend execution budgets", () => {
    expect(LOCAL_ACTION_TIMEOUT_MS.preflight).toBeGreaterThan(85_000);
    expect(LOCAL_ACTION_TIMEOUT_MS.scaffold).toBeGreaterThan(300_000);
  });

  it("rejects malformed and schema-invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":"yes"}')));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk })).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("preserves bounded public error details for specific recovery guidance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: "Parent folder must stay inside the managed DuskDS project root.",
      code: "scaffold_parent_outside_root"
    }), { status: 422, headers: { "content-type": "application/json" } })));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk })).rejects.toMatchObject({
      kind: "http-error",
      status: 422,
      code: "scaffold_parent_outside_root",
      message: "Parent folder must stay inside the managed DuskDS project root."
    });
  });

  it("announces an authenticated companion-session loss without confusing unrelated 401 responses", async () => {
    const listener = vi.fn();
    window.addEventListener(COMPANION_SESSION_LOST_EVENT, listener);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 401 })));
    await expect(requestJson("http://127.0.0.1:8788/preflight", { validate: isOk })).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce();
    listener.mockClear();
    await expect(requestJson("https://testnet.nodes.dusk.network/health", { validate: isOk })).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(COMPANION_SESSION_LOST_EVENT, listener);
  });

  it("rejects declared and streamed oversized bodies", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Leave the declared-oversized body open until the boundary cancels it.
      },
      cancel() {
        cancelled = true;
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { headers: { "content-length": "100" } })));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk, maxBytes: 32 })).rejects.toMatchObject({ kind: "oversized-response" });
    expect(cancelled).toBe(true);
  });

  it("distinguishes timeout from caller cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))));
    await expect(requestJson("http://127.0.0.1/test", { validate: isOk, timeoutMs: 5 })).rejects.toMatchObject({ kind: "timeout" });
    const controller = new AbortController();
    const request = requestJson("http://127.0.0.1/test", { validate: isOk, signal: controller.signal, timeoutMs: 1_000 });
    controller.abort();
    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("keeps timeout classification when response headers arrive but the body stalls", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        }
      });
      return new Response(stream, { status: 200 });
    }));

    await expect(requestJson("http://127.0.0.1/test", {
      validate: isOk,
      timeoutMs: 5
    })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("keeps cancellation classification when the caller aborts during body streaming", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        }
      });
      return new Response(stream, { status: 200 });
    }));
    const controller = new AbortController();
    const request = requestJson("http://127.0.0.1/test", {
      validate: isOk,
      signal: controller.signal,
      timeoutMs: 1_000
    });

    controller.abort();
    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
  });
});
