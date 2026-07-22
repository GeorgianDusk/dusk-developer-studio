import assert from "node:assert/strict";

const EXPECTED_PREFLIGHT_URL = "http://127.0.0.1:8788/preflight?path=duskds";
const EXPECTED_STUDIO_ORIGIN = "http://127.0.0.1:5173";
const RESPONSE_BODY_EVICTION =
  /Network[.]getResponseBody.*No data found for resource with given identifier/u;

export function captureResponseJson(response) {
  const settled = response.json().then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  return async () => {
    const result = await settled;
    if (!result.ok) throw result.error;
    return result.value;
  };
}

export async function readPreflightResponseJson({
  context,
  expectedOrigin,
  expectedUrl,
  response,
  timeoutMs
}) {
  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!RESPONSE_BODY_EVICTION.test(message)) throw error;

    assert.equal(
      expectedUrl,
      EXPECTED_PREFLIGHT_URL,
      "The response-body fallback may replay only the exact DuskDS preflight endpoint."
    );
    assert.equal(
      expectedOrigin,
      EXPECTED_STUDIO_ORIGIN,
      "The response-body fallback may replay only from the exact local Studio origin."
    );
    const stableResponse = await context.request.get(expectedUrl, {
      headers: { origin: expectedOrigin },
      timeout: timeoutMs
    });
    assert.equal(
      stableResponse.status(),
      200,
      "The exact-package preflight replay must succeed after Chrome evicts the observed response body."
    );
    return stableResponse.json();
  }
}
