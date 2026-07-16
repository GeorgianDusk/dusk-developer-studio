import { describe, expect, it, vi } from "vitest";
import {
  DUSK_EVM_NETWORKS,
  checkRpcHealth,
  explorerAddressUrl,
  explorerTxUrl,
  getDefaultDuskEvmNetwork,
  parseHexBlockNumber,
  redactSensitive,
  searchCapabilities,
  searchResources,
  searchTroubleshooting
} from "../index";

describe("DuskEVM network config", () => {
  it("loads source-labeled network metadata", () => {
    expect(DUSK_EVM_NETWORKS.length).toBeGreaterThanOrEqual(3);
    const testnet = getDefaultDuskEvmNetwork();
    expect(testnet.chainId).toBe(745);
    expect(testnet.chainIdHex).toBe("0x2e9");
    expect(testnet.enabledByDefault).toBe(true);
    expect(testnet.sourceUrl).toContain("docs.dusk.network");
  });
});

describe("RPC health", () => {
  it("returns healthy when the chain id matches", async () => {
    const fetchImpl = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body)) as { method: string };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: body.method === "eth_chainId" ? "0x2e9" : "0x10" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result.status).toBe("healthy");
    expect(parseHexBlockNumber(result.blockNumberHex)).toBe(16);
  });

  it("detects wrong-chain responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;

    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result.status).toBe("wrong-chain");
    expect(result.actualChainIdHex).toBe("0x1");
  });
});

describe("explorer helpers", () => {
  const network = getDefaultDuskEvmNetwork();

  it("creates valid explorer links", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const tx = `0x${"a".repeat(64)}`;
    expect(explorerAddressUrl(network, address)).toContain(`/address/${address}`);
    expect(explorerTxUrl(network, tx)).toContain(`/tx/${tx}`);
  });

  it("rejects malformed values", () => {
    expect(() => explorerAddressUrl(network, "0x123")).toThrow("Invalid EVM address");
    expect(() => explorerTxUrl(network, "0x123")).toThrow("Invalid transaction hash");
  });
});

describe("resource search", () => {
  it("finds funding, troubleshooting, and capability records", () => {
    expect(searchResources("bridge").some((item) => item.id === "duskevm-bridge")).toBe(true);
    expect(searchTroubleshooting("forge").some((item) => item.id === "foundry-missing")).toBe(true);
    expect(searchCapabilities("citadel").some((item) => item.id === "citadel-private-identity")).toBe(true);
    expect(searchCapabilities("hedger").some((item) => item.id === "duskevm-confidential-hedger")).toBe(true);
  });
});

describe("redaction", () => {
  it("redacts private-key-like values and secrets", () => {
    const privateKeyLike = `0x${"a".repeat(64)}`;
    const text = `private_key=${privateKeyLike} api_key=supersecret`;
    const redacted = redactSensitive(text);
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain("[redacted]");
  });
});
