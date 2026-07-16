import type { DuskEvmNetwork } from "../config/network.schema";
import { BoundedJsonError, readBoundedJson } from "../security/boundedJson";
import { explorerAddressUrl, explorerBlockUrl, explorerTxUrl, isAddress, isTxHash } from "./explorer";

export type EvmIdentifier =
  | { type: "address"; value: string }
  | { type: "transaction"; value: string }
  | { type: "block"; value: string };

export type EvmReadFailureKind = "timeout" | "http-error" | "cors-or-network" | "invalid-response" | "oversized-response" | "not-found";

export interface EvmReadResult {
  ok: boolean;
  kind: EvmIdentifier["type"];
  summary: string;
  explorerUrl: string;
  checkedAt: string;
  sourceUrl: string;
  failureKind?: EvmReadFailureKind;
  details: string[];
}

interface RpcEnvelope<T> {
  jsonrpc?: string;
  result?: T;
  error?: { message?: string };
}

class EvmReadError extends Error {
  constructor(readonly kind: EvmReadFailureKind, message: string) { super(message); }
}

export function classifyEvmIdentifier(input: string): EvmIdentifier | undefined {
  const value = input.trim();
  if (isAddress(value)) return { type: "address", value };
  if (isTxHash(value)) return { type: "transaction", value };
  if (/^(0x[0-9a-f]+|\d+)$/i.test(value)) {
    const block = value.startsWith("0x") ? value.toLowerCase() : `0x${BigInt(value).toString(16)}`;
    return { type: "block", value: block };
  }
  return undefined;
}

async function rpcRead<T>(network: DuskEvmNetwork, method: string, params: unknown[], fetchImpl: typeof fetch, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(network.rpcUrls[0], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new EvmReadError("timeout", "The read-only RPC request timed out.");
      throw new EvmReadError("cors-or-network", "The browser could not reach the Testnet RPC.");
    }
    if (!response.ok) throw new EvmReadError("http-error", `Testnet RPC returned HTTP ${response.status}.`);
    let value: unknown;
    try { value = await readBoundedJson(response, 256 * 1024); }
    catch (error) {
      if (error instanceof BoundedJsonError && error.kind === "oversized-response") throw new EvmReadError("oversized-response", "Testnet RPC response exceeded the safe size limit.");
      throw new EvmReadError("invalid-response", "Testnet RPC returned invalid JSON.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid envelope.");
    const payload = value as RpcEnvelope<T>;
    if (payload.error) throw new EvmReadError("invalid-response", "Testnet RPC returned a JSON-RPC error.");
    if (payload.jsonrpc !== "2.0" || !("result" in payload)) throw new EvmReadError("invalid-response", "Testnet RPC returned an incomplete response.");
    return payload.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]+$/i.test(value);
}

export async function inspectEvmIdentifier(network: DuskEvmNetwork, identifier: EvmIdentifier, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): Promise<EvmReadResult> {
  const checkedAt = new Date().toISOString();
  const sourceUrl = network.sourceUrl;
  const explorerUrl = identifier.type === "address" ? explorerAddressUrl(network, identifier.value)
    : identifier.type === "transaction" ? explorerTxUrl(network, identifier.value)
      : explorerBlockUrl(network, identifier.value);
  try {
    if (identifier.type === "address") {
      const code = await rpcRead<unknown>(network, "eth_getCode", [identifier.value, "latest"], fetchImpl, timeoutMs);
      if (code === null) return { ok: false, kind: identifier.type, summary: "Address was not returned by the RPC.", explorerUrl, checkedAt, sourceUrl, failureKind: "not-found", details: [] };
      if (typeof code !== "string" || !/^0x[0-9a-f]*$/i.test(code)) throw new EvmReadError("invalid-response", "Testnet RPC returned invalid address bytecode.");
      const isContract = !/^0x0*$/i.test(code);
      return { ok: true, kind: identifier.type, summary: isContract ? "Contract bytecode is present at this address." : "The address is valid, but no contract bytecode is present.", explorerUrl, checkedAt, sourceUrl, details: [`Code: ${isContract ? `${Math.max(0, (code.length - 2) / 2)} bytes` : "none"}`] };
    }
    if (identifier.type === "transaction") {
      const receipt = await rpcRead<unknown>(network, "eth_getTransactionReceipt", [identifier.value], fetchImpl, timeoutMs);
      if (!receipt) return { ok: false, kind: identifier.type, summary: "No receipt yet. The transaction may be pending or unknown.", explorerUrl, checkedAt, sourceUrl, failureKind: "not-found", details: [] };
      if (typeof receipt !== "object" || Array.isArray(receipt)) throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid transaction receipt.");
      const typed = receipt as { status?: unknown; blockNumber?: unknown; contractAddress?: unknown };
      if ((typed.status !== undefined && !isHexQuantity(typed.status))
          || (typed.blockNumber !== undefined && !isHexQuantity(typed.blockNumber))
          || (typed.contractAddress !== undefined && typed.contractAddress !== null && (typeof typed.contractAddress !== "string" || !/^0x[0-9a-f]{40}$/i.test(typed.contractAddress)))) {
        throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid transaction receipt.");
      }
      const status = typeof typed.status === "string" ? typed.status : undefined;
      const blockNumber = typeof typed.blockNumber === "string" ? typed.blockNumber : undefined;
      const contractAddress = typeof typed.contractAddress === "string" ? typed.contractAddress : null;
      const succeeded = status?.toLowerCase() === "0x1";
      return { ok: true, kind: identifier.type, summary: succeeded ? "The transaction receipt reports success." : "The transaction receipt reports a failed or unknown status.", explorerUrl, checkedAt, sourceUrl, details: [`Status: ${status ?? "unknown"}`, `Block: ${blockNumber ? BigInt(blockNumber).toString() : "pending"}`, `Contract: ${contractAddress ?? "not a contract creation"}`] };
    }
    const block = await rpcRead<unknown>(network, "eth_getBlockByNumber", [identifier.value, false], fetchImpl, timeoutMs);
    if (!block) return { ok: false, kind: identifier.type, summary: "Block was not found on Testnet.", explorerUrl, checkedAt, sourceUrl, failureKind: "not-found", details: [] };
    if (typeof block !== "object" || Array.isArray(block)) throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid block.");
    const typed = block as { number?: unknown; hash?: unknown; transactions?: unknown };
    if ((typed.number !== undefined && !isHexQuantity(typed.number))
        || (typed.hash !== undefined && (typeof typed.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(typed.hash)))
        || (typed.transactions !== undefined && !Array.isArray(typed.transactions))) {
      throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid block.");
    }
    const blockNumber = typeof typed.number === "string" ? typed.number : undefined;
    const hash = typeof typed.hash === "string" ? typed.hash : undefined;
    const transactions = Array.isArray(typed.transactions) ? typed.transactions : [];
    return { ok: true, kind: identifier.type, summary: "Block was returned by the Testnet RPC.", explorerUrl, checkedAt, sourceUrl, details: [`Height: ${blockNumber ? BigInt(blockNumber).toString() : "unknown"}`, `Hash: ${hash ?? "unknown"}`, `Transactions: ${transactions.length}`] };
  } catch (error) {
    const classified = error instanceof EvmReadError ? error : new EvmReadError("invalid-response", "Read-only inspection failed.");
    return { ok: false, kind: identifier.type, summary: classified.message, explorerUrl, checkedAt, sourceUrl, failureKind: classified.kind, details: [] };
  }
}
