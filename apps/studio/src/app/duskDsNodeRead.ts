import { DUSKDS_TESTNET_NODE } from "./manualJourneyConfig";

export const DUSKDS_GRAPHQL_ENDPOINT = `${DUSKDS_TESTNET_NODE}/on/graphql/query`;
export const DUSKDS_LATEST_BLOCK_QUERY = "query { block(height: -1) { header { height hash } } }";

export interface DuskDsBlockObservation {
  height: number;
  hash: string;
  endpoint: string;
  observedAt: string;
}
export type DuskDsNodeReadFailure =
  | "timeout"
  | "unavailable"
  | "http-error"
  | "oversized-response"
  | "invalid-response";

export class DuskDsNodeReadError extends Error {
  constructor(readonly kind: DuskDsNodeReadFailure, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DuskDsNodeReadError";
  }
}

const MAX_NODE_RESPONSE_BYTES = 32_768;

async function readBoundedNodeBody(response: Response): Promise<Uint8Array> {
  const rawLength = response.headers.get("content-length");
  const declaredLength = rawLength === null ? undefined : Number(rawLength);
  if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > MAX_NODE_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new DuskDsNodeReadError("oversized-response", "The public node response exceeded the safe size limit.", false);
  }
  if (!response.body) {
    throw new DuskDsNodeReadError("invalid-response", "The public node returned an empty response body.", false);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_NODE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new DuskDsNodeReadError("oversized-response", "The public node response exceeded the safe size limit.", false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function normalizeHeight(value: unknown): number | undefined {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

export function normalizeDuskDsBlockObservation(value: unknown, observedAt = new Date().toISOString()): DuskDsBlockObservation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = "data" in value && value.data && typeof value.data === "object" ? value.data : value;
  if (!data || typeof data !== "object" || !("block" in data) || !data.block || typeof data.block !== "object") return undefined;
  const block = data.block;
  if (!("header" in block) || !block.header || typeof block.header !== "object") return undefined;
  const header = block.header;
  const height = "height" in header ? normalizeHeight(header.height) : undefined;
  const hash = "hash" in header && typeof header.hash === "string" && /^(?:0x)?[a-f0-9]{64}$/i.test(header.hash)
    ? header.hash.toLowerCase()
    : undefined;
  if (height === undefined || !hash) return undefined;
  return { height, hash, endpoint: DUSKDS_TESTNET_NODE, observedAt };
}

export async function readLatestDuskDsBlock(fetcher: typeof fetch = fetch): Promise<DuskDsBlockObservation> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 5_000);
  try {
    let response: Response;
    try {
      response = await fetcher(DUSKDS_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: DUSKDS_LATEST_BLOCK_QUERY,
        signal: controller.signal
      });
    } catch {
      throw new DuskDsNodeReadError(
        timedOut ? "timeout" : "unavailable",
        timedOut ? "The public Testnet node did not answer before the five-second limit." : "The public Testnet node could not be reached from this browser.",
        true
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DuskDsNodeReadError("http-error", `The public Testnet node returned HTTP ${response.status}.`, response.status >= 500 || response.status === 408 || response.status === 429);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedNodeBody(response);
    } catch (error) {
      if (error instanceof DuskDsNodeReadError) throw error;
      throw new DuskDsNodeReadError(
        controller.signal.aborted ? "timeout" : "unavailable",
        controller.signal.aborted
          ? "The public Testnet node did not finish its response before the five-second limit."
          : "The public Testnet node response was interrupted.",
        true
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new DuskDsNodeReadError("invalid-response", "The public node returned invalid JSON.", false);
    }
    const observation = normalizeDuskDsBlockObservation(value);
    if (!observation) {
      throw new DuskDsNodeReadError("invalid-response", "The public node response did not contain a bounded block height and 32-byte hash.", false);
    }
    return observation;
  } finally {
    window.clearTimeout(timeout);
  }
}
