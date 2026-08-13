import { describe, expect, it, vi } from "vitest";
import { classifyEvmIdentifier, getDefaultDuskEvmNetwork, inspectEvmIdentifier } from "../index";

const network = getDefaultDuskEvmNetwork();

function response(result: unknown): Response {
  const value = new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  Object.defineProperty(value, "url", { value: new URL(network.rpcUrls[0]).href, configurable: true });
  return value;
}

function queuedFetch(...results: unknown[]) {
  return vi.fn(async () => response(results.shift()));
}

describe("read-only EVM inspection", () => {
  it("classifies identifiers and only accepts canonical bounded block quantities", () => {
    expect(classifyEvmIdentifier(`0x${"a".repeat(40)}`)?.type).toBe("address");
    expect(classifyEvmIdentifier(`0x${"b".repeat(64)}`)?.type).toBe("transaction");
    expect(classifyEvmIdentifier("745")).toEqual({ type: "block", value: "0x2e9" });
    expect(classifyEvmIdentifier("0x0")).toEqual({ type: "block", value: "0x0" });
    expect(classifyEvmIdentifier("0x1234")).toEqual({ type: "block", value: "0x1234" });
    expect(classifyEvmIdentifier(`0x${"c".repeat(41)}`)?.type).toBe("block");
    expect(classifyEvmIdentifier("0x00")).toBeUndefined();
    expect(classifyEvmIdentifier("0x01")).toBeUndefined();
    expect(classifyEvmIdentifier(`0x${"f".repeat(65)}`)).toBeUndefined();
    expect(classifyEvmIdentifier((1n << 256n).toString())).toBeUndefined();
    expect(classifyEvmIdentifier("dusk")).toBeUndefined();
  });

  it("returns evidence-backed contract code status", async () => {
    const fetchMock = vi.fn(async () => response("0x60016000"));
    const identifier = classifyEvmIdentifier(`0x${"a".repeat(40)}`)!;
    const result = await inspectEvmIdentifier(network, identifier, fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: true, kind: "address" });
    expect(result.summary).toMatch(/bytecode is present/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects odd-length address bytecode instead of reporting fractional bytes", async () => {
    const identifier = classifyEvmIdentifier(`0x${"a".repeat(40)}`)!;
    const result = await inspectEvmIdentifier(network, identifier, queuedFetch("0x1") as typeof fetch);
    expect(result).toMatchObject({ ok: false, failureKind: "invalid-response" });
    expect(result.details).toEqual([]);
  });

  it("keeps a missing receipt unverified", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const fetchMock = queuedFetch(null, null);
    const result = await inspectEvmIdentifier(network, identifier, fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: false, failureKind: "not-found", transactionStatus: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a pending transaction from an unknown hash", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const fetchMock = queuedFetch(null, { hash: identifier.value, blockNumber: null });
    const result = await inspectEvmIdentifier(network, identifier, fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: true, transactionStatus: "pending" });
    expect(result.summary).toMatch(/pending/i);
  });

  it("reports a reverted receipt without describing it as success", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const fetchMock = queuedFetch({ transactionHash: identifier.value, status: "0x0", blockNumber: "0x10", contractAddress: null });
    const result = await inspectEvmIdentifier(network, identifier, fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: true, transactionStatus: "reverted" });
    expect(result.summary).toMatch(/reverted/i);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps successful inclusion separate from finality", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const fetchMock = queuedFetch(
      { transactionHash: identifier.value, status: "0x1", blockNumber: "0x10", contractAddress: `0x${"c".repeat(40)}` },
      { number: "0xf" }
    );
    const result = await inspectEvmIdentifier(network, identifier, fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: true, transactionStatus: "included" });
    expect(result.summary).toMatch(/finality was not established/i);
  });

  it("uses the RPC finalized tag without inventing a confirmation count", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const fetchMock = queuedFetch(
      { transactionHash: identifier.value, status: "0x1", blockNumber: "0x10", contractAddress: null },
      { number: "0x12" }
    );
    const result = await inspectEvmIdentifier(network, identifier, fetchMock as typeof fetch);
    expect(result).toMatchObject({ ok: true, transactionStatus: "rpc-finalized" });
    expect(result.details.join("\n")).toContain("RPC finality signal: finalized block 18");
    expect(result.details.join("\n")).toContain("DuskDS settlement was not established");
  });

  it("rejects incomplete receipts and mismatched JSON-RPC response IDs", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const incomplete = await inspectEvmIdentifier(
      network,
      identifier,
      queuedFetch({ transactionHash: identifier.value, status: "0x1" }) as typeof fetch
    );
    expect(incomplete).toMatchObject({ ok: false, failureKind: "invalid-response" });

    const wrongId = vi.fn(async () => {
      const value = new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 9, result: { status: "0x1", blockNumber: "0x10" } }),
      { status: 200 }
      );
      Object.defineProperty(value, "url", { value: network.rpcUrls[0] });
      return value;
    });
    const mismatched = await inspectEvmIdentifier(network, identifier, wrongId as typeof fetch);
    expect(mismatched).toMatchObject({ ok: false, failureKind: "invalid-response" });
  });

  it("rejects mismatched transaction, receipt, block, and endpoint identities", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const wrongTransaction = await inspectEvmIdentifier(
      network,
      identifier,
      queuedFetch(null, { hash: `0x${"c".repeat(64)}`, blockNumber: null }) as typeof fetch
    );
    expect(wrongTransaction).toMatchObject({ ok: false, failureKind: "invalid-response" });

    const wrongReceipt = await inspectEvmIdentifier(
      network,
      identifier,
      queuedFetch({ transactionHash: `0x${"c".repeat(64)}`, status: "0x1", blockNumber: "0x10" }) as typeof fetch
    );
    expect(wrongReceipt).toMatchObject({ ok: false, failureKind: "invalid-response" });

    const wrongBlock = await inspectEvmIdentifier(
      network,
      { type: "block", value: "0x10" },
      queuedFetch({ number: "0x11", hash: `0x${"d".repeat(64)}`, transactions: [] }) as typeof fetch
    );
    expect(wrongBlock).toMatchObject({ ok: false, failureKind: "invalid-response" });

    const redirectedResponse = response("0x");
    Object.defineProperty(redirectedResponse, "url", { value: "https://untrusted.invalid/" });
    const redirected = await inspectEvmIdentifier(
      network,
      { type: "address", value: `0x${"a".repeat(40)}` },
      vi.fn(async () => redirectedResponse) as typeof fetch
    );
    expect(redirected).toMatchObject({ ok: false, failureKind: "invalid-response" });
  });
});
