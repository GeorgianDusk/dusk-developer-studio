import assert from "node:assert/strict";
import { clearTimeout, setTimeout } from "node:timers";

const LATE_ABORT_TEXT = "net::ERR_ABORTED";
const EXPECTED_PREFLIGHT_URL = "http://127.0.0.1:8788/preflight?path=duskds";
const EXPECTED_STUDIO_ORIGIN = "http://127.0.0.1:5173";

export function createRequestTerminalTracker({
  finishedRequests,
  requestFailures,
  timeoutMs
}) {
  assert.ok(
    Number.isFinite(timeoutMs) && timeoutMs > 0,
    "Request terminal-event timeout must be a positive finite number."
  );
  const waiters = new Map();
  const hasTerminalEvent = (request) =>
    finishedRequests.has(request)
    || requestFailures.some((failure) => failure.request === request);

  function notify(request) {
    if (hasTerminalEvent(request)) {
      waiters.get(request)?.();
    }
  }

  function wait(request, label) {
    assert.ok(request, `${label} must provide an exact Request object.`);
    assert.equal(
      waiters.has(request),
      false,
      `${label} already has a pending terminal-event wait.`
    );
    if (hasTerminalEvent(request)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        waiters.delete(request);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => {
        settle(new Error(
          `${label} did not produce a terminal browser request event within ${timeoutMs}ms.`
        ));
      }, timeoutMs);
      waiters.set(request, () => settle());
      // Close the race where the event is recorded after the first check but
      // before its exact Request-object waiter is registered.
      if (hasTerminalEvent(request)) {
        settle();
      }
    });
  }

  return { notify, wait };
}

function matchingResponseEvents(responseEvents, url, status) {
  return responseEvents.filter((event) => event.url === url && event.status === status);
}

function validateResponseBinding(event, method, responseByRequest, label) {
  assert.equal(
    event.request.url(),
    event.url,
    `${label} must use the exact observed response URL.`
  );
  assert.equal(
    event.request.method(),
    method,
    `${label} must use ${method}.`
  );
  assert.equal(
    responseByRequest.get(event.request),
    event.response,
    `${label} must remain bound to its exact Playwright Request and Response objects.`
  );
}

function validateTerminalState({
  event,
  finishedRequests,
  label,
  requestFailures,
  responseByRequest
}) {
  const finishedSequence = finishedRequests.get(event.request);
  if (finishedSequence !== undefined) {
    assert.ok(
      finishedSequence > event.sequence,
      `${label} cannot finish before its successful response.`
    );
  }
  const correlatedAborts = requestFailures.filter((failure) =>
    failure.request === event.request
    && failure.url === event.url
    && failure.text === LATE_ABORT_TEXT
    && failure.sequence > event.sequence
    && responseByRequest.get(failure.request) === event.response
  );
  assert.ok(
    correlatedAborts.length <= 1,
    `${label} produced duplicate Chromium abort telemetry.`
  );
  assert.ok(
    (finishedSequence !== undefined) !== (correlatedAborts.length === 1),
    `${label} must either finish or produce exactly one correlated late Chromium abort.`
  );
  return correlatedAborts;
}

function validatePairingTransportEvidence({
  bootstrapRequest,
  expectedBootstrapUrl,
  expectedProbeUrl,
  finishedRequests,
  pairingValidated,
  requestFailures,
  responseByRequest,
  responseEvents
}) {
  assert.equal(
    pairingValidated,
    true,
    "Pairing transport telemetry is acceptable only after the application validates the health body and renders the expected release mode."
  );

  const probeEvents = matchingResponseEvents(responseEvents, expectedProbeUrl, 401);
  const bootstrapEvents = matchingResponseEvents(responseEvents, expectedBootstrapUrl, 200);
  const authenticatedHealthEvents = matchingResponseEvents(responseEvents, expectedProbeUrl, 200);
  assert.equal(
    probeEvents.length,
    1,
    "Local pairing must observe exactly one unauthenticated health response."
  );
  assert.equal(
    bootstrapEvents.length,
    1,
    "Local pairing must observe exactly one successful bootstrap response."
  );
  assert.equal(
    authenticatedHealthEvents.length,
    1,
    "Local pairing must observe exactly one successful authenticated health response."
  );

  const [probeEvent] = probeEvents;
  const [bootstrapEvent] = bootstrapEvents;
  const [authenticatedHealthEvent] = authenticatedHealthEvents;
  assert.equal(
    bootstrapEvent.request,
    bootstrapRequest,
    "The successful bootstrap response must belong to the single validated bootstrap request."
  );
  validateResponseBinding(probeEvent, "GET", responseByRequest, "Unauthenticated health");
  validateResponseBinding(bootstrapEvent, "POST", responseByRequest, "Bootstrap");
  validateResponseBinding(
    authenticatedHealthEvent,
    "GET",
    responseByRequest,
    "Authenticated health"
  );
  assert.ok(
    probeEvent.sequence < bootstrapEvent.sequence
      && bootstrapEvent.sequence < authenticatedHealthEvent.sequence,
    "Local pairing must observe unauthenticated health, successful bootstrap, then authenticated health in order."
  );

  const probeAborts = validateTerminalState({
    event: probeEvent,
    finishedRequests,
    label: "The expected unauthenticated health request",
    requestFailures,
    responseByRequest
  });
  const bootstrapAborts = validateTerminalState({
    event: bootstrapEvent,
    finishedRequests,
    label: "The successful bootstrap request",
    requestFailures,
    responseByRequest
  });
  const authenticatedHealthAborts = validateTerminalState({
    event: authenticatedHealthEvent,
    finishedRequests,
    label: "The successful authenticated health request",
    requestFailures,
    responseByRequest
  });
  return {
    authenticatedHealthSequence: authenticatedHealthEvent.sequence,
    lateAbortTelemetry: {
      unauthenticated_health: probeAborts.length,
      authenticated_health: authenticatedHealthAborts.length,
      bootstrap: bootstrapAborts.length
    },
    toleratedFailures: [
      ...probeAborts,
      ...bootstrapAborts,
      ...authenticatedHealthAborts
    ]
  };
}

function validatePreflightTransportEvidence({
  afterSequence,
  expectedPreflightUrl,
  finishedRequests,
  mode,
  preflightContractValidated,
  preflightRequestHeaders,
  preflightResponse,
  preflightResponseHeaders,
  preflightUiRendered,
  requestFailures,
  responseByRequest,
  responseEvents
}) {
  if (mode === "safe") {
    assert.equal(expectedPreflightUrl, undefined);
    assert.equal(preflightContractValidated, false);
    assert.equal(preflightRequestHeaders, undefined);
    assert.equal(preflightResponse, undefined);
    assert.equal(preflightResponseHeaders, undefined);
    assert.equal(preflightUiRendered, false);
    assert.equal(
      matchingResponseEvents(responseEvents, EXPECTED_PREFLIGHT_URL, 200).length,
      0,
      "Safe mode cannot issue a successful Local Actions preflight request."
    );
    return { lateAbortTelemetry: 0, toleratedFailures: [] };
  }
  assert.equal(mode, "local-actions", "Browser transport mode is invalid.");
  assert.equal(
    expectedPreflightUrl,
    EXPECTED_PREFLIGHT_URL,
    "Preflight telemetry may classify only the exact DuskDS endpoint."
  );
  assert.equal(
    preflightContractValidated,
    true,
    "Preflight transport telemetry requires successful authoritative contract validation."
  );
  assert.equal(
    preflightUiRendered,
    true,
    "Preflight transport telemetry requires the application to render the validated response."
  );
  assert.ok(preflightResponse, "Preflight transport telemetry requires the exact page response.");
  const preflightEvents = matchingResponseEvents(responseEvents, EXPECTED_PREFLIGHT_URL, 200);
  assert.equal(
    preflightEvents.length,
    1,
    "Local Actions must observe exactly one successful DuskDS preflight response."
  );
  const [preflightEvent] = preflightEvents;
  assert.equal(
    preflightEvent.response,
    preflightResponse,
    "Preflight telemetry must bind the exact captured page Response object."
  );
  assert.equal(
    preflightEvent.request,
    preflightResponse.request(),
    "Preflight telemetry must bind the original page-owned Request object."
  );
  validateResponseBinding(
    preflightEvent,
    "GET",
    responseByRequest,
    "The successful DuskDS preflight request"
  );
  assert.equal(
    preflightEvent.request.redirectedFrom(),
    null,
    "The successful DuskDS preflight request cannot follow a redirect."
  );
  assert.equal(
    preflightRequestHeaders?.origin,
    EXPECTED_STUDIO_ORIGIN,
    "The successful DuskDS preflight request must carry the exact Studio origin."
  );
  assert.equal(
    preflightResponseHeaders?.["access-control-allow-origin"],
    EXPECTED_STUDIO_ORIGIN,
    "The successful DuskDS preflight response must allow only the exact Studio origin."
  );
  assert.equal(
    preflightResponseHeaders?.["access-control-allow-credentials"],
    "true",
    "The successful DuskDS preflight response must retain credentialed CORS."
  );
  assert.ok(
    preflightEvent.sequence > afterSequence,
    "The successful DuskDS preflight response must occur after authenticated pairing."
  );
  const preflightAborts = validateTerminalState({
    event: preflightEvent,
    finishedRequests,
    label: "The successful DuskDS preflight request",
    requestFailures,
    responseByRequest
  });
  return {
    lateAbortTelemetry: preflightAborts.length,
    toleratedFailures: preflightAborts
  };
}

export function validateBrowserTransportEvidence(input) {
  const pairing = validatePairingTransportEvidence(input);
  const preflight = validatePreflightTransportEvidence({
    ...input,
    afterSequence: pairing.authenticatedHealthSequence
  });
  const toleratedFailures = new Set([
    ...pairing.toleratedFailures,
    ...preflight.toleratedFailures
  ]);
  assert.deepEqual(
    input.requestFailures
      .filter((failure) => !toleratedFailures.has(failure))
      .map(({ text, url }) => ({ text, url })),
    [],
    "Browser smoke produced an unexpected request failure."
  );
  return {
    lateAbortTelemetry: {
      ...pairing.lateAbortTelemetry,
      preflight: preflight.lateAbortTelemetry
    }
  };
}
