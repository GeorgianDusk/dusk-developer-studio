import assert from "node:assert/strict";
import {
  captureResponseJson,
  readPreflightResponseJson
} from "./npm-package-browser-response.mjs";

const expectedOrigin = "http://127.0.0.1:5173";
const expectedUrl = "http://127.0.0.1:8788/preflight?path=duskds";
const evictionError = new Error(
  "apiResponse.json: Protocol error (Network.getResponseBody): No data found for resource with given identifier"
);

function input({
  body = { ok: true },
  error = evictionError,
  origin = expectedOrigin,
  status = 200,
  url = expectedUrl
} = {}) {
  const calls = [];
  return {
    calls,
    value: {
      context: {
        request: {
          get: async (requestedUrl, options) => {
            calls.push({ requestedUrl, options });
            return { status: () => status, json: async () => body };
          }
        }
      },
      expectedOrigin: origin,
      expectedUrl: url,
      response: { json: async () => { throw error; } },
      timeoutMs: 130_000
    }
  };
}

{
  let resolveBody;
  let reads = 0;
  const readCaptured = captureResponseJson({
    json: () => {
      reads += 1;
      return new Promise((resolve) => { resolveBody = resolve; });
    }
  });
  assert.equal(reads, 1, "Response capture must begin while Chrome still retains the body.");
  resolveBody({ ok: true, source: "captured-immediately" });
  assert.deepEqual(await readCaptured(), { ok: true, source: "captured-immediately" });
  assert.equal(reads, 1);
}

{
  const expected = new Error("captured response failed");
  const readCaptured = captureResponseJson({ json: async () => { throw expected; } });
  await assert.rejects(() => readCaptured(), expected);
}

{
  let replayed = false;
  const original = { ok: true, source: "observed-response" };
  const result = await readPreflightResponseJson({
    context: { request: { get: async () => { replayed = true; } } },
    expectedOrigin,
    expectedUrl,
    response: { json: async () => original },
    timeoutMs: 130_000
  });
  assert.equal(result, original);
  assert.equal(replayed, false);
}

{
  const { calls, value } = input();
  assert.deepEqual(await readPreflightResponseJson(value), { ok: true });
  assert.deepEqual(calls, [{
    requestedUrl: expectedUrl,
    options: { headers: { origin: expectedOrigin }, timeout: 130_000 }
  }]);
}

for (const [options, pattern] of [
  [{ error: new Error("different failure") }, /different failure/u],
  [{ origin: "http://localhost:5173" }, /exact local Studio origin/u],
  [{ url: "http://127.0.0.1:8788/health" }, /exact DuskDS preflight endpoint/u],
  [{ status: 403 }, /must succeed/u]
]) {
  const { calls, value } = input(options);
  await assert.rejects(() => readPreflightResponseJson(value), pattern);
  if (options.error || options.origin || options.url) assert.equal(calls.length, 0);
}

console.log("Npm package browser response-body fallback checks passed.");
