const DEFAULT_MAX_JSON_BYTES = 256 * 1024;

export class BoundedJsonError extends Error {
  constructor(readonly kind: "invalid-json" | "oversized-response", message: string) {
    super(message);
    this.name = "BoundedJsonError";
  }
}

function declaredLength(response: Response): number | undefined {
  const raw = response.headers?.get?.("content-length") ?? null;
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function readBoundedJson(
  response: Response,
  maxBytes = DEFAULT_MAX_JSON_BYTES
): Promise<unknown> {
  const length = declaredLength(response);
  if (length !== undefined && length > maxBytes) {
    throw new BoundedJsonError("oversized-response", "Response exceeded the permitted size.");
  }

  let bytes: Uint8Array;
  if (response.body) {
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
          throw new BoundedJsonError("oversized-response", "Response exceeded the permitted size.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const text = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
    bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maxBytes) {
      throw new BoundedJsonError("oversized-response", "Response exceeded the permitted size.");
    }
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BoundedJsonError("invalid-json", "Response was not valid UTF-8 JSON.");
  }
}
