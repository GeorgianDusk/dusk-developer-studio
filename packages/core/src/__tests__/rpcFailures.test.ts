import { describe, expect, it, vi } from "vitest";
import { checkRpcHealth, getDefaultDuskEvmNetwork } from "../index";

describe("RPC failure classification", () => {
  it("reports HTTP failures separately", async () => {
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result).toMatchObject({ status: "http-error", failureKind: "http-error", httpStatus: 503, retryable: true });
  });

  it("reports browser CORS or network failures separately", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result).toMatchObject({ status: "cors-or-network", failureKind: "cors-or-network", retryable: true });
  });

  it("reports invalid JSON-RPC payloads", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as unknown as typeof fetch;
    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result).toMatchObject({ status: "invalid-response", failureKind: "invalid-response" });
  });

  it("times out a stalled request", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, request?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      request?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl, { timeoutMs: 5 });
    expect(result).toMatchObject({ status: "timeout", failureKind: "timeout", retryable: true });
  });
});
