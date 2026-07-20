import assert from "node:assert/strict";

const LATE_ABORT_TEXT = "net::ERR_ABORTED";

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

export function validatePairingTransportEvidence({
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
  const toleratedFailures = new Set([...bootstrapAborts, ...authenticatedHealthAborts]);
  assert.deepEqual(
    requestFailures
      .filter((failure) => !toleratedFailures.has(failure))
      .map(({ text, url }) => ({ text, url })),
    [],
    "Browser smoke produced an unexpected request failure."
  );

  return {
    lateAbortTelemetry: {
      authenticated_health: authenticatedHealthAborts.length,
      bootstrap: bootstrapAborts.length
    }
  };
}
