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
});
