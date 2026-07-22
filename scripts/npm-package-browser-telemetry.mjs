import assert from "node:assert/strict";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

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

function matchingEndpointEvents(events, url) {
  const expected = new URL(url);
  const allowedOrigins = new Set([expected.origin]);
  const allowedPathnames = new Set([expected.pathname]);
  if (
    expected.protocol === "http:"
    && (expected.hostname === "127.0.0.1" || expected.hostname === "localhost")
    && expected.port
  ) {
    allowedOrigins.add(`http://127.0.0.1:${expected.port}`);
    allowedOrigins.add(`http://localhost:${expected.port}`);
  }
  if (
    expected.protocol === "http:"
    && expected.port === "8788"
    && (expected.pathname === "/health" || expected.pathname === "/healthz")
  ) {
    allowedPathnames.add("/health");
    allowedPathnames.add("/healthz");
  }
  return events.filter((event) => {
    const observed = new URL(event.url);
    return allowedOrigins.has(observed.origin) && allowedPathnames.has(observed.pathname);
  });
}

function validateEndpointEventBijection(requestEvents, responseEvents, label) {
  const requestObjects = requestEvents.map((event) => {
    assert.equal(
      event.request.url(),
      event.url,
      `${label} request inventory must retain the exact Request URL.`
    );
    return event.request;
  });
  const responseRequests = responseEvents.map((event) => event.request);
  assert.equal(
    new Set(requestObjects).size,
    requestObjects.length,
    `${label} request inventory must contain distinct Request objects.`
  );
  assert.equal(
    new Set(responseRequests).size,
    responseRequests.length,
    `${label} responses must belong to distinct Request objects.`
  );
  assert.equal(
    new Set(responseEvents.map((event) => event.response)).size,
    responseEvents.length,
    `${label} must contain distinct Response objects.`
  );
  const requestIdentitySet = new Set(requestObjects);
  assert.equal(
    responseRequests.every((request) => requestIdentitySet.has(request)),
    true,
    `${label} request and response inventories must be bijectively reference-bound.`
  );
}

function validateResponseBinding(event, method, expectedUrl, responseByRequest, label) {
  assert.equal(
    event.url,
    expectedUrl,
    `${label} must use the exact allowed URL and query.`
  );
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
    event.request.redirectedFrom(),
    null,
    `${label} cannot follow a redirect.`
  );
  assert.equal(
    event.response.request(),
    event.request,
    `${label} Response must point back to the exact observed Request object.`
  );
  assert.equal(
    event.response.url(),
    event.url,
    `${label} Response URL must match the immutable observed response record.`
  );
  assert.equal(
    event.response.status(),
    event.status,
    `${label} Response status must match the immutable observed response record.`
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
  healthRequest,
  pairingValidated,
  probeRequest,
  requestEvents,
  requestFailures,
  responseByRequest,
  responseEvents
}) {
  assert.equal(
    pairingValidated,
    true,
    "Pairing transport telemetry is acceptable only after the application validates both session-status bodies and renders the expected release mode."
  );

  const probeEndpointEvents = matchingEndpointEvents(responseEvents, expectedProbeUrl);
  const bootstrapEndpointEvents = matchingEndpointEvents(responseEvents, expectedBootstrapUrl);
  const probeRequestEvents = matchingEndpointEvents(requestEvents, expectedProbeUrl);
  const bootstrapRequestEvents = matchingEndpointEvents(requestEvents, expectedBootstrapUrl);
  assert.equal(
    probeEndpointEvents.length,
    2,
    "Local pairing must observe exactly two session-status responses and no alternate-status duplicates."
  );
  assert.equal(
    bootstrapEndpointEvents.length,
    1,
    "Local pairing must observe exactly one bootstrap response and no alternate-status duplicates."
  );
  assert.equal(
    probeRequestEvents.length,
    2,
    "Local pairing must issue exactly two page session-status requests."
  );
  assert.equal(
    bootstrapRequestEvents.length,
    1,
    "Local pairing must issue exactly one page bootstrap request."
  );
  validateEndpointEventBijection(
    probeRequestEvents,
    probeEndpointEvents,
    "Local pairing session status"
  );
  validateEndpointEventBijection(
    bootstrapRequestEvents,
    bootstrapEndpointEvents,
    "Local pairing bootstrap"
  );
  const bootstrapEvents = matchingResponseEvents(bootstrapEndpointEvents, expectedBootstrapUrl, 200);
  const probeEvents = probeEndpointEvents.filter((event) => event.request === probeRequest);
  const authenticatedHealthEvents =
    probeEndpointEvents.filter((event) => event.request === healthRequest);
  assert.equal(
    probeEvents.length,
    1,
    "Local pairing must observe exactly one validated unpaired session response."
  );
  assert.equal(
    bootstrapEvents.length,
    1,
    "Local pairing must observe exactly one successful bootstrap response."
  );
  assert.equal(
    authenticatedHealthEvents.length,
    1,
    "Local pairing must observe exactly one validated paired session response."
  );

  const [probeEvent] = probeEvents;
  const [bootstrapEvent] = bootstrapEvents;
  const [authenticatedHealthEvent] = authenticatedHealthEvents;
  assert.equal(
    bootstrapEvent.request,
    bootstrapRequest,
    "The successful bootstrap response must belong to the single validated bootstrap request."
  );
  validateResponseBinding(
    probeEvent,
    "GET",
    expectedProbeUrl,
    responseByRequest,
    "Unpaired session status"
  );
  validateResponseBinding(
    bootstrapEvent,
    "POST",
    expectedBootstrapUrl,
    responseByRequest,
    "Bootstrap"
  );
  validateResponseBinding(
    authenticatedHealthEvent,
    "GET",
    expectedProbeUrl,
    responseByRequest,
    "Paired session status"
  );
  assert.equal(probeEvent.status, 200, "The unpaired session status must be a successful bounded response.");
  assert.equal(authenticatedHealthEvent.status, 200, "The paired session status must be a successful bounded response.");
  assert.ok(
    probeEvent.sequence < bootstrapEvent.sequence
      && bootstrapEvent.sequence < authenticatedHealthEvent.sequence,
    "Local pairing must observe unpaired status, successful bootstrap, then paired status in order."
  );

  const probeAborts = validateTerminalState({
    event: probeEvent,
    finishedRequests,
    label: "The expected unpaired session-status request",
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
    label: "The successful paired session-status request",
    requestFailures,
    responseByRequest
  });
  return {
    pairedSessionSequence: authenticatedHealthEvent.sequence,
    lateAbortTelemetry: {
      unpaired_session: probeAborts.length,
      paired_session: authenticatedHealthAborts.length,
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
  requestEvents,
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
      matchingEndpointEvents(requestEvents, EXPECTED_PREFLIGHT_URL).length,
      0,
      "Safe mode cannot issue any Local Actions preflight request."
    );
    assert.equal(
      matchingEndpointEvents(responseEvents, EXPECTED_PREFLIGHT_URL).length,
      0,
      "Safe mode cannot observe any Local Actions preflight response."
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
  const preflightRequestEvents = matchingEndpointEvents(requestEvents, EXPECTED_PREFLIGHT_URL);
  const preflightEvents = matchingEndpointEvents(responseEvents, EXPECTED_PREFLIGHT_URL);
  assert.equal(
    preflightRequestEvents.length,
    1,
    "Local Actions must issue exactly one DuskDS preflight request."
  );
  assert.equal(
    preflightEvents.length,
    1,
    "Local Actions must observe exactly one DuskDS preflight response of any status."
  );
  const [preflightEvent] = preflightEvents;
  validateEndpointEventBijection(
    preflightRequestEvents,
    preflightEvents,
    "DuskDS preflight"
  );
  assert.equal(
    preflightRequestEvents[0].request,
    preflightEvent.request,
    "Preflight telemetry must bind the sole page request to the sole response."
  );
  assert.equal(
    preflightEvent.status,
    200,
    "The sole DuskDS preflight response must be successful."
  );
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
    EXPECTED_PREFLIGHT_URL,
    responseByRequest,
    "The successful DuskDS preflight request"
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
    afterSequence: pairing.pairedSessionSequence
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
