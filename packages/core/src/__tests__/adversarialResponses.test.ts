import { describe, expect, it, vi } from "vitest";
import { checkRpcHealth, getDefaultDuskEvmNetwork, getWalletAccounts, getWalletBalance, getWalletChainId, inspectEvmIdentifier } from "../index";

const network = getDefaultDuskEvmNetwork();
const address = `0x${"a".repeat(40)}`;

function jsonResponse(result: unknown, id = 1): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("adversarial external responses", () => {
  it("rejects malformed wallet chain IDs, account lists, and balances", async () => {
    await expect(getWalletChainId({ request: vi.fn(async () => "745") } as never)).rejects.toThrow("invalid chain ID");
    await expect(getWalletAccounts({ request: vi.fn(async () => ({ 0: address })) } as never)).rejects.toThrow("invalid account list");
    await expect(getWalletBalance({ request: vi.fn(async () => "1 DUSK") } as never, address)).rejects.toThrow("invalid balance");
  });

  it("filters malicious account entries instead of persisting them", async () => {
    const accounts = await getWalletAccounts({ request: vi.fn(async () => [address, "<script>secret</script>", 7]) } as never);
    expect(accounts).toEqual([address]);
  });

  it("rejects JSON-RPC envelopes with the wrong request id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("0x2e9", 999));
    const result = await checkRpcHealth(network, fetchMock as typeof fetch);
    expect(result).toMatchObject({ status: "invalid-response", retryable: true });
  });

  it("classifies oversized RPC health responses", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-length": String(65 * 1024) } }));
    const result = await checkRpcHealth(network, fetchMock as typeof fetch);
    expect(result).toMatchObject({ status: "oversized-response", failureKind: "oversized-response" });
  });

  it("rejects malformed receipt and block fields", async () => {
    const tx = { type: "transaction" as const, value: `0x${"b".repeat(64)}` };
    const receipt = await inspectEvmIdentifier(network, tx, vi.fn(async () => jsonResponse({ status: "success", blockNumber: "later" })) as typeof fetch);
    expect(receipt).toMatchObject({ ok: false, failureKind: "invalid-response" });
    const block = await inspectEvmIdentifier(network, { type: "block", value: "0x1" }, vi.fn(async () => jsonResponse({ number: "0x1", hash: "not-a-hash", transactions: [] })) as typeof fetch);
    expect(block).toMatchObject({ ok: false, failureKind: "invalid-response" });
  });

  it("classifies late RPC responses as timeouts", async () => {
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const result = await checkRpcHealth(network, fetchMock as typeof fetch, { timeoutMs: 5 });
    expect(result).toMatchObject({ status: "timeout", failureKind: "timeout" });
  });
});
