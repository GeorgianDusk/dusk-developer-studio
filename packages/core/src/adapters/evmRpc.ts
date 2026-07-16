import type { DuskEvmNetwork } from "../config/network.schema";
import { BoundedJsonError, readBoundedJson } from "../security/boundedJson";

export type RpcHealthStatus = "healthy" | "wrong-chain" | "timeout" | "http-error" | "cors-or-network" | "invalid-response" | "oversized-response";
export type RpcFailureKind = Exclude<RpcHealthStatus, "healthy" | "wrong-chain">;

export interface RpcHealthResult {
  status: RpcHealthStatus;
  networkId: string;
  rpcUrl: string;
  expectedChainIdHex: string;
  actualChainIdHex?: string;
  blockNumberHex?: string;
  latencyMs: number;
  checkedAt: string;
  message: string;
  failureKind?: RpcFailureKind;
  httpStatus?: number;
  retryable: boolean;
}

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

class RpcCheckError extends Error {
  constructor(readonly kind: RpcFailureKind, message: string, readonly httpStatus?: number) {
    super(message);
  }
}

function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  validate: (value: unknown) => value is T
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
      signal
    });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new RpcCheckError("timeout", "RPC check timed out. Retry or use the official endpoint status channel.");
    }
    throw new RpcCheckError("cors-or-network", "The browser could not reach the RPC. Check connectivity, browser CORS policy, or the official endpoint.");
  }

  if (!response.ok) {
    throw new RpcCheckError("http-error", `RPC returned HTTP ${response.status}. Retry later or check the official endpoint.`, response.status);
  }

  let value: unknown;
  try {
    value = await readBoundedJson(response, 64 * 1024);
  } catch (error) {
    if (error instanceof BoundedJsonError && error.kind === "oversized-response") {
      throw new RpcCheckError("oversized-response", `RPC ${method} exceeded the response size limit.`);
    }
    throw new RpcCheckError("invalid-response", `RPC ${method} returned invalid JSON.`);
  }
  if (!isRecord(value)) throw new RpcCheckError("invalid-response", `RPC ${method} returned an invalid JSON-RPC envelope.`);
  const payload = value as unknown as JsonRpcResponse<unknown>;
  if (payload.error) throw new RpcCheckError("invalid-response", `RPC ${method} returned a JSON-RPC error.`);
  if (payload.jsonrpc !== "2.0" || payload.id !== 1 || payload.result === undefined || !validate(payload.result)) {
    throw new RpcCheckError("invalid-response", `RPC ${method} returned an incomplete or invalid JSON-RPC response.`);
  }
  return payload.result;
}

export async function checkRpcHealth(
  network: DuskEvmNetwork,
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number } = {}
): Promise<RpcHealthResult> {
  const started = performance.now();
  const rpcUrl = network.rpcUrls[0];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const chainId = await rpcCall<string>(rpcUrl, "eth_chainId", fetchImpl, controller.signal, isHexQuantity);
    const blockNumber = await rpcCall<string>(rpcUrl, "eth_blockNumber", fetchImpl, controller.signal, isHexQuantity);
    const latencyMs = Math.round(performance.now() - started);
    const normalizedChainId = chainId.toLowerCase();
    const expectedChainId = network.chainIdHex.toLowerCase();

    if (normalizedChainId !== expectedChainId) {
      return {
        status: "wrong-chain",
        networkId: network.id,
        rpcUrl,
        expectedChainIdHex: expectedChainId,
        actualChainIdHex: normalizedChainId,
        blockNumberHex: blockNumber,
        latencyMs,
        checkedAt: new Date().toISOString(),
        message: `RPC answered with chain ${normalizedChainId}; Testnet requires ${expectedChainId}. Do not fund or deploy until these match.`,
        retryable: true
      };
    }

    return {
      status: "healthy",
      networkId: network.id,
      rpcUrl,
      expectedChainIdHex: expectedChainId,
      actualChainIdHex: normalizedChainId,
      blockNumberHex: blockNumber,
      latencyMs,
      checkedAt: new Date().toISOString(),
      message: `RPC is healthy and reporting Testnet chain ${normalizedChainId}.`,
      retryable: false
    };
  } catch (error) {
    const classified = error instanceof RpcCheckError
      ? error
      : new RpcCheckError("invalid-response", "RPC request failed.");
    return {
      status: classified.kind,
      failureKind: classified.kind,
      httpStatus: classified.httpStatus,
      networkId: network.id,
      rpcUrl,
      expectedChainIdHex: network.chainIdHex.toLowerCase(),
      latencyMs: Math.round(performance.now() - started),
      checkedAt: new Date().toISOString(),
      message: classified.message,
      retryable: true
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseHexBlockNumber(blockNumberHex?: string): number | undefined {
  if (!blockNumberHex || !isHexQuantity(blockNumberHex)) return undefined;
  const parsed = Number.parseInt(blockNumberHex, 16);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
