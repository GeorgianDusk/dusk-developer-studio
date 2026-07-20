import { describe, expect, it, vi } from "vitest";
import {
  DUSKDS_GRAPHQL_ENDPOINT,
  DUSKDS_LATEST_BLOCK_QUERY,
  DuskDsNodeReadError,
  normalizeDuskDsBlockObservation,
  readLatestDuskDsBlock
} from "./duskDsNodeRead";

describe("DuskDS public node read", () => {
  it("normalizes only a bounded height and 32-byte hash", () => {
    expect(normalizeDuskDsBlockObservation({
      data: { block: { header: { height: "42", hash: "A".repeat(64), extra: "ignored" } } }
    }, "2026-07-17T10:00:00.000Z")).toEqual({
      height: 42,
      hash: "a".repeat(64),
      endpoint: "https://testnet.nodes.dusk.network",
      observedAt: "2026-07-17T10:00:00.000Z"
    });
    expect(normalizeDuskDsBlockObservation({ data: { block: { header: { height: -1, hash: "secret" } } } })).toBeUndefined();
  });

  it("performs one bounded read-only GraphQL request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { block: { header: { height: 99, hash: `0x${"b".repeat(64)}` } } }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await readLatestDuskDsBlock(fetcher);
    expect(result).toMatchObject({ height: 99, hash: `0x${"b".repeat(64)}` });
    expect(fetcher).toHaveBeenCalledWith(DUSKDS_GRAPHQL_ENDPOINT, expect.objectContaining({
      method: "POST",
      body: DUSKDS_LATEST_BLOCK_QUERY
    }));
  });

  it("rejects unbounded or malformed responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(readLatestDuskDsBlock(fetcher)).rejects.toMatchObject({ kind: "invalid-response", retryable: false } satisfies Partial<DuskDsNodeReadError>);
  });

  it("cancels an oversized streamed body even when Content-Length understates it", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(20_000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      }
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "content-length": "1", "content-type": "application/json" }
    }));

    await expect(readLatestDuskDsBlock(fetcher)).rejects.toMatchObject({
      kind: "oversized-response",
      retryable: false
    } satisfies Partial<DuskDsNodeReadError>);
    expect(cancelled).toBe(true);
  });

  it("cancels an HTTP-error response stream without reading it", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the error body open until the reader explicitly cancels it.
      },
      cancel() {
        cancelled = true;
      }
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(stream, { status: 503 }));

    await expect(readLatestDuskDsBlock(fetcher)).rejects.toMatchObject({
      kind: "http-error",
      retryable: true
    } satisfies Partial<DuskDsNodeReadError>);
    expect(cancelled).toBe(true);
  });

  it("reports a timeout when headers arrive but the response body stalls", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
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
      });
      const request = readLatestDuskDsBlock(fetcher as typeof fetch);
      const rejection = expect(request).rejects.toMatchObject({
        kind: "timeout",
        retryable: true
      } satisfies Partial<DuskDsNodeReadError>);

      await vi.advanceTimersByTimeAsync(5_001);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
