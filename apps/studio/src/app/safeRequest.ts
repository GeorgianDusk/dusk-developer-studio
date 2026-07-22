export type RequestFailureKind =
  | "cancelled"
  | "timeout"
  | "http-error"
  | "invalid-response"
  | "oversized-response"
  | "unavailable";

export class SafeRequestError extends Error {
  constructor(
    readonly kind: RequestFailureKind,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "SafeRequestError";
  }
}

export type Validator<T> = (value: unknown) => value is T;

interface RequestJsonOptions<T> {
  init?: RequestInit;
  timeoutMs?: number;
  maxBytes?: number;
  validate: Validator<T>;
  signal?: AbortSignal;
}

const DEFAULT_MAX_BYTES = 64 * 1024;

export const LOCAL_ACTION_TIMEOUT_MS = {
  // DuskDS preflight runs its bounded tool checks sequentially. Their current
  // worst-case process budget is 85 seconds, so this leaves bounded response
  // and filesystem overhead without inheriting the short read-request limit.
  preflight: 120_000,
  // Forge starter creation has a 300-second backend process limit, followed by
  // bounded tree verification and atomic promotion.
  scaffold: 330_000
} as const;

function parsePublicError(bytes: Uint8Array): { error?: string; code?: string } {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    return {
      ...(typeof record.error === "string" && record.error.length <= 512 ? { error: record.error } : {}),
      ...(typeof record.code === "string" && /^[a-z0-9_]{1,64}$/.test(record.code) ? { code: record.code } : {})
    };
  } catch {
    return {};
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const rawLength = response.headers?.get?.("content-length") ?? null;
  const length = rawLength ? Number(rawLength) : undefined;
  if (length !== undefined && Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeRequestError("oversized-response", "The local response exceeded the safe size limit.", false);
  }

  if (!response.body) {
    const text = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maxBytes) {
      throw new SafeRequestError("oversized-response", "The local response exceeded the safe size limit.", false);
    }
    return bytes;
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
      if (total > maxBytes) {
        await reader.cancel();
        throw new SafeRequestError("oversized-response", "The local response exceeded the safe size limit.", false);
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

export const COMPANION_SESSION_LOST_EVENT = "dusk-studio-companion-session-lost";

function isLoopbackCompanionRequest(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "8788";
  } catch {
    return false;
  }
}

export async function requestJson<T>(url: string, options: RequestJsonOptions<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 5_000);

  try {
    let response: Response;
    let bytes: Uint8Array;
    try {
      response = await fetch(url, { ...options.init, signal: controller.signal });
      bytes = await readBoundedBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    } catch (error) {
      if (error instanceof SafeRequestError) throw error;
      if (controller.signal.aborted) {
        if (timedOut) throw new SafeRequestError("timeout", "The local request timed out.", true);
        throw new SafeRequestError("cancelled", "The local request was cancelled.", true);
      }
      throw new SafeRequestError("unavailable", "The local companion is unavailable.", true);
    }
    if (!response.ok) {
      const publicError = parsePublicError(bytes);
      if (response.status === 401 && isLoopbackCompanionRequest(url)) {
        window.dispatchEvent(new Event(COMPANION_SESSION_LOST_EVENT));
      }
      throw new SafeRequestError(
        "http-error",
        response.status === 401
          ? "The local companion needs to be paired."
          : publicError.error ?? `The local companion returned HTTP ${response.status}.`,
        response.status >= 500 || response.status === 408 || response.status === 429,
        response.status,
        publicError.code
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new SafeRequestError("invalid-response", "The local companion returned invalid JSON.", false);
    }
    if (!options.validate(value)) {
      throw new SafeRequestError("invalid-response", "The local companion returned an unexpected response shape.", false);
    }
    return value;
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function safeRequestMessage(error: unknown): string {
  if (!(error instanceof SafeRequestError)) return "The local companion is unavailable.";
  switch (error.kind) {
    case "timeout": return "Local companion did not answer before the timeout. Retry once it is ready.";
    case "cancelled": return "The local request was cancelled before completion.";
    case "oversized-response": return "The local companion returned more data than this screen accepts.";
    case "invalid-response": return "The local companion returned data this Studio cannot safely use.";
    default: return error.message;
  }
}
