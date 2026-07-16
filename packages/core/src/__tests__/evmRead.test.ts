import { describe, expect, it, vi } from "vitest";
import { classifyEvmIdentifier, getDefaultDuskEvmNetwork, inspectEvmIdentifier } from "../index";

const network = getDefaultDuskEvmNetwork();

function response(result: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) } as Response;
}

describe("read-only EVM inspection", () => {
  it("classifies address, transaction, decimal block, and rejects arbitrary input", () => {
    expect(classifyEvmIdentifier(`0x${"a".repeat(40)}`)?.type).toBe("address");
    expect(classifyEvmIdentifier(`0x${"b".repeat(64)}`)?.type).toBe("transaction");
    expect(classifyEvmIdentifier("745")).toEqual({ type: "block", value: "0x2e9" });
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

  it("keeps a missing receipt unverified", async () => {
    const identifier = classifyEvmIdentifier(`0x${"b".repeat(64)}`)!;
    const result = await inspectEvmIdentifier(network, identifier, vi.fn(async () => response(null)) as typeof fetch);
    expect(result).toMatchObject({ ok: false, failureKind: "not-found" });
  });
});
