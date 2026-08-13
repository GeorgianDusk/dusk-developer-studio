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
  transactionStatus?: "pending" | "included" | "reverted" | "rpc-finalized" | "unknown";
  details: string[];
}

interface RpcEnvelope<T> {
  jsonrpc?: string;
  id?: unknown;
  result?: T;
  error?: { message?: string };
}

class EvmReadError extends Error {
  constructor(readonly kind: EvmReadFailureKind, message: string) { super(message); }
}

const MAX_EVM_QUANTITY = (1n << 256n) - 1n;

export function classifyEvmIdentifier(input: string): EvmIdentifier | undefined {
  const value = input.trim();
  if (isAddress(value)) return { type: "address", value };
  if (isTxHash(value)) return { type: "transaction", value };
  if (/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)) {
    return { type: "block", value: value.toLowerCase() };
  }
  if (/^\d{1,78}$/.test(value)) {
    const blockNumber = BigInt(value);
    if (blockNumber <= MAX_EVM_QUANTITY) {
      return { type: "block", value: `0x${blockNumber.toString(16)}` };
    }
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
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new EvmReadError("timeout", "The read-only RPC request timed out.");
      throw new EvmReadError("cors-or-network", "The browser could not reach the Testnet RPC.");
    }
    if (response.redirected || response.url !== new URL(network.rpcUrls[0]).href) {
      throw new EvmReadError("invalid-response", "Testnet RPC changed the exact reviewed endpoint URL.");
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
    if (payload.jsonrpc !== "2.0" || payload.id !== 1 || !("result" in payload)) {
      throw new EvmReadError("invalid-response", "Testnet RPC returned an incomplete or mismatched response.");
    }
    return payload.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
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
      if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(code)) throw new EvmReadError("invalid-response", "Testnet RPC returned invalid address bytecode.");
      const isContract = !/^0x0*$/i.test(code);
      return { ok: true, kind: identifier.type, summary: isContract ? "Contract bytecode is present at this address." : "The address is valid, but no contract bytecode is present.", explorerUrl, checkedAt, sourceUrl, details: [`Code: ${isContract ? `${Math.max(0, (code.length - 2) / 2)} bytes` : "none"}`] };
    }
    if (identifier.type === "transaction") {
      const receipt = await rpcRead<unknown>(network, "eth_getTransactionReceipt", [identifier.value], fetchImpl, timeoutMs);
      if (!receipt) {
        const transaction = await rpcRead<unknown>(network, "eth_getTransactionByHash", [identifier.value], fetchImpl, timeoutMs);
        if (!transaction) {
          return {
            ok: false,
            kind: identifier.type,
            summary: "The RPC knows neither a transaction nor a receipt for this hash.",
            explorerUrl,
            checkedAt,
            sourceUrl,
            failureKind: "not-found",
            transactionStatus: "unknown",
            details: ["Status: unknown", "A replaced, dropped, mistyped, or not-yet-propagated transaction cannot be distinguished from this hash alone."]
          };
        }
        if (typeof transaction !== "object" || Array.isArray(transaction)) throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid transaction.");
        const pending = transaction as { hash?: unknown; blockNumber?: unknown };
        if (typeof pending.hash !== "string" || pending.hash.toLowerCase() !== identifier.value.toLowerCase()) {
          throw new EvmReadError("invalid-response", "Testnet RPC returned a transaction for a different hash.");
        }
        if (!("blockNumber" in pending)
            || (pending.blockNumber !== null && !isHexQuantity(pending.blockNumber))) {
          throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid transaction block.");
        }
        if (pending.blockNumber === null) {
          return {
            ok: true,
            kind: identifier.type,
            summary: "The transaction is pending and has no receipt yet.",
            explorerUrl,
            checkedAt,
            sourceUrl,
            transactionStatus: "pending",
            details: ["Status: pending", "A later receipt may report success or revert; do not resubmit without checking the signer account and nonce."]
          };
        }
        return {
          ok: false,
          kind: identifier.type,
          summary: "The RPC returned an included transaction but no receipt, so its outcome is unknown.",
          explorerUrl,
          checkedAt,
          sourceUrl,
          failureKind: "not-found",
          transactionStatus: "unknown",
          details: [`Transaction block: ${BigInt(pending.blockNumber).toString()}`, "Status: unknown"]
        };
      }
      if (typeof receipt !== "object" || Array.isArray(receipt)) throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid transaction receipt.");
      const typed = receipt as { transactionHash?: unknown; status?: unknown; blockNumber?: unknown; contractAddress?: unknown };
      if (typeof typed.transactionHash !== "string"
          || typed.transactionHash.toLowerCase() !== identifier.value.toLowerCase()
          || !isHexQuantity(typed.status)
          || !isHexQuantity(typed.blockNumber)
          || (typed.contractAddress !== undefined && typed.contractAddress !== null && (typeof typed.contractAddress !== "string" || !/^0x[0-9a-f]{40}$/i.test(typed.contractAddress)))) {
        throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid transaction receipt.");
      }
      const status = typed.status;
      const blockNumber = typed.blockNumber;
      const contractAddress = typeof typed.contractAddress === "string" ? typed.contractAddress : null;
      const succeeded = status?.toLowerCase() === "0x1";
      const reverted = status?.toLowerCase() === "0x0";
      if (!succeeded && !reverted) {
        return {
          ok: false,
          kind: identifier.type,
          summary: "The transaction receipt has an unknown execution status.",
          explorerUrl,
          checkedAt,
          sourceUrl,
          failureKind: "invalid-response",
          transactionStatus: "unknown",
          details: [`Status: ${status ?? "unknown"}`, `Block: ${blockNumber ? BigInt(blockNumber).toString() : "unknown"}`]
        };
      }
      if (reverted) {
        return {
          ok: true,
          kind: identifier.type,
          summary: "The transaction was included and reverted.",
          explorerUrl,
          checkedAt,
          sourceUrl,
          transactionStatus: "reverted",
          details: [`Status: reverted (${status})`, `Block: ${blockNumber ? BigInt(blockNumber).toString() : "unknown"}`, `Contract: ${contractAddress ?? "not created"}`]
        };
      }
      let transactionStatus: EvmReadResult["transactionStatus"] = "included";
      let finalityDetail = "Finality: not established by this read";
      try {
        const finalizedBlock = await rpcRead<unknown>(network, "eth_getBlockByNumber", ["finalized", false], fetchImpl, timeoutMs);
        if (finalizedBlock && typeof finalizedBlock === "object" && !Array.isArray(finalizedBlock)) {
          const finalizedNumber = (finalizedBlock as { number?: unknown }).number;
          if (isHexQuantity(finalizedNumber) && BigInt(blockNumber) <= BigInt(finalizedNumber)) {
            transactionStatus = "rpc-finalized";
            finalityDetail = `RPC finality signal: finalized block ${BigInt(finalizedNumber).toString()}; DuskDS settlement was not established`;
          }
        }
      } catch {
        // Inclusion remains valid even when this RPC does not expose the optional finalized tag.
      }
      return {
        ok: true,
        kind: identifier.type,
        summary: transactionStatus === "rpc-finalized"
          ? "The transaction succeeded and is at or below the RPC-reported finalized block; DuskDS settlement was not established."
          : "The transaction succeeded and is included; finality was not established.",
        explorerUrl,
        checkedAt,
        sourceUrl,
        transactionStatus,
        details: [`Status: ${transactionStatus}`, `Receipt: success (${status})`, `Block: ${blockNumber ? BigInt(blockNumber).toString() : "unknown"}`, finalityDetail, `Contract: ${contractAddress ?? "not a contract creation"}`]
      };
    }
    const block = await rpcRead<unknown>(network, "eth_getBlockByNumber", [identifier.value, false], fetchImpl, timeoutMs);
    if (!block) return { ok: false, kind: identifier.type, summary: "Block was not found on Testnet.", explorerUrl, checkedAt, sourceUrl, failureKind: "not-found", details: [] };
    if (typeof block !== "object" || Array.isArray(block)) throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid block.");
    const typed = block as { number?: unknown; hash?: unknown; transactions?: unknown };
    if (!isHexQuantity(typed.number)
        || typed.number.toLowerCase() !== identifier.value.toLowerCase()
        || typeof typed.hash !== "string"
        || !/^0x[0-9a-f]{64}$/i.test(typed.hash)
        || !Array.isArray(typed.transactions)) {
      throw new EvmReadError("invalid-response", "Testnet RPC returned an invalid block.");
    }
    const blockNumber = typed.number;
    const hash = typed.hash;
    const transactions = typed.transactions;
    return { ok: true, kind: identifier.type, summary: "Block was returned by the Testnet RPC.", explorerUrl, checkedAt, sourceUrl, details: [`Height: ${blockNumber ? BigInt(blockNumber).toString() : "unknown"}`, `Hash: ${hash ?? "unknown"}`, `Transactions: ${transactions.length}`] };
  } catch (error) {
    const classified = error instanceof EvmReadError ? error : new EvmReadError("invalid-response", "Read-only inspection failed.");
    return { ok: false, kind: identifier.type, summary: classified.message, explorerUrl, checkedAt, sourceUrl, failureKind: classified.kind, details: [] };
  }
}
