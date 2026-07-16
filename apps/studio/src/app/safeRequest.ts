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
    readonly status?: number
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

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const rawLength = response.headers?.get?.("content-length") ?? null;
  const length = rawLength ? Number(rawLength) : undefined;
  if (length !== undefined && Number.isFinite(length) && length > maxBytes) {
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

export async function requestJson<T>(url: string, options: RequestJsonOptions<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 5_000);

  try {
    let response: Response;
    try {
      response = await fetch(url, { ...options.init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) {
        if (timedOut) throw new SafeRequestError("timeout", "The local request timed out.", true);
        throw new SafeRequestError("cancelled", "The local request was cancelled.", true);
      }
      throw new SafeRequestError("unavailable", "The local companion is unavailable.", true);
    }
    if (!response.ok) {
      throw new SafeRequestError(
        "http-error",
        response.status === 401
          ? "The local companion needs to be paired."
          : `The local companion returned HTTP ${response.status}.`,
        response.status >= 500 || response.status === 408 || response.status === 429,
        response.status
      );
    }

    const bytes = await readBoundedBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
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
