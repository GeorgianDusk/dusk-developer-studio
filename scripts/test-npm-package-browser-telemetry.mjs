import assert from "node:assert/strict";
import { setTimeout } from "node:timers";
import {
  createRequestTerminalTracker,
  validateBrowserTransportEvidence
} from "./npm-package-browser-telemetry.mjs";

const expectedProbeUrl = "http://127.0.0.1:8788/health";
const expectedBootstrapUrl = "http://127.0.0.1:5173/__dusk/bootstrap";
const expectedPreflightUrl = "http://127.0.0.1:8788/preflight?path=duskds";
const expectedStudioOrigin = "http://127.0.0.1:5173";

function request(method, url, {
  headers = {},
  redirectedFrom = null
} = {}) {
  return {
    headers: () => headers,
    method: () => method,
    redirectedFrom: () => redirectedFrom,
    url: () => url
  };
}

function response(requestObject, headers = {}) {
  return { headers: () => headers, request: () => requestObject };
}

function fixture({
  bootstrapAbort = false,
  healthAbort = false,
  preflight = false,
  preflightAbort = false,
  probeAbort = false
} = {}) {
  const probeRequest = request("GET", expectedProbeUrl);
  const bootstrapRequest = request("POST", expectedBootstrapUrl);
  const healthRequest = request("GET", expectedProbeUrl);
  const preflightRequest = request("GET", expectedPreflightUrl, {
    headers: { origin: expectedStudioOrigin }
  });
  const probeResponse = response(probeRequest);
  const bootstrapResponse = response(bootstrapRequest);
  const healthResponse = response(healthRequest);
  const preflightResponse = response(preflightRequest, {
    "access-control-allow-origin": expectedStudioOrigin,
    "access-control-allow-credentials": "true"
  });
  const responseEvents = [
    {
      request: probeRequest,
      response: probeResponse,
      sequence: 1,
      status: 401,
      url: expectedProbeUrl
    },
    {
      request: bootstrapRequest,
      response: bootstrapResponse,
      sequence: 2,
      status: 200,
      url: expectedBootstrapUrl
    },
    {
      request: healthRequest,
      response: healthResponse,
      sequence: 3,
      status: 200,
      url: expectedProbeUrl
    }
  ];
  const responseByRequest = new Map([
    [probeRequest, probeResponse],
    [bootstrapRequest, bootstrapResponse],
    [healthRequest, healthResponse]
  ]);
  if (preflight) {
    responseEvents.push({
      request: preflightRequest,
      response: preflightResponse,
      sequence: 4,
      status: 200,
      url: expectedPreflightUrl
    });
    responseByRequest.set(preflightRequest, preflightResponse);
  }
  const requestFailures = [];
  const finishedRequests = new Map();
  let sequence = preflight ? 5 : 4;
  if (probeAbort) {
    requestFailures.push({
      request: probeRequest,
      sequence: sequence++,
      text: "net::ERR_ABORTED",
      url: expectedProbeUrl
    });
  } else {
    finishedRequests.set(probeRequest, sequence++);
  }
  if (bootstrapAbort) {
    requestFailures.push({
      request: bootstrapRequest,
      sequence: sequence++,
      text: "net::ERR_ABORTED",
      url: expectedBootstrapUrl
    });
  } else {
    finishedRequests.set(bootstrapRequest, sequence++);
  }
  if (healthAbort) {
    requestFailures.push({
      request: healthRequest,
      sequence: sequence++,
      text: "net::ERR_ABORTED",
      url: expectedProbeUrl
    });
  } else {
    finishedRequests.set(healthRequest, sequence++);
  }
  if (preflight) {
    if (preflightAbort) {
      requestFailures.push({
        request: preflightRequest,
        sequence: sequence++,
        text: "net::ERR_ABORTED",
        url: expectedPreflightUrl
      });
    } else {
      finishedRequests.set(preflightRequest, sequence++);
    }
  }
  return {
    bootstrapRequest,
    expectedBootstrapUrl,
    expectedPreflightUrl: preflight ? expectedPreflightUrl : undefined,
    expectedProbeUrl,
    finishedRequests,
    healthRequest,
    mode: preflight ? "local-actions" : "safe",
    pairingValidated: true,
    preflightContractValidated: preflight,
    preflightRequestHeaders: preflight ? { origin: expectedStudioOrigin } : undefined,
    preflightRequest,
    preflightResponse: preflight ? preflightResponse : undefined,
    preflightResponseHeaders: preflight ? preflightResponse.headers() : undefined,
    preflightUiRendered: preflight,
    probeRequest,
    requestFailures,
    responseByRequest,
    responseEvents
  };
}

function validate(input) {
  return validateBrowserTransportEvidence(input);
}

for (const [options, telemetry] of [
  [{}, { unauthenticated_health: 0, authenticated_health: 0, bootstrap: 0, preflight: 0 }],
  [{ probeAbort: true }, { unauthenticated_health: 1, authenticated_health: 0, bootstrap: 0, preflight: 0 }],
  [{ healthAbort: true }, { unauthenticated_health: 0, authenticated_health: 1, bootstrap: 0, preflight: 0 }],
  [{ bootstrapAbort: true }, { unauthenticated_health: 0, authenticated_health: 0, bootstrap: 1, preflight: 0 }],
  [
    { bootstrapAbort: true, healthAbort: true, probeAbort: true },
    { unauthenticated_health: 1, authenticated_health: 1, bootstrap: 1, preflight: 0 }
  ],
  [
    { preflight: true },
    { unauthenticated_health: 0, authenticated_health: 0, bootstrap: 0, preflight: 0 }
  ],
  [
    { preflight: true, preflightAbort: true },
    { unauthenticated_health: 0, authenticated_health: 0, bootstrap: 0, preflight: 1 }
  ]
]) {
  assert.deepEqual(validate(fixture(options)).lateAbortTelemetry, telemetry);
}

{
  const input = fixture({ preflight: true, preflightAbort: true });
  input.requestFailures.at(-1).sequence = 4;
  assert.throws(() => validate(input), /must either finish|unexpected request failure/u);
}
{
  const input = fixture({ preflight: true, preflightAbort: true });
  input.requestFailures.at(-1).request = request("GET", expectedPreflightUrl);
  assert.throws(() => validate(input), /must either finish/u);
}
for (const mutation of [
  (input) => { input.requestFailures.at(-1).text = "net::ERR_FAILED"; },
  (input) => { input.requestFailures.at(-1).url = `${expectedPreflightUrl}&retry=1`; },
  (input) => { input.preflightRequest.url = () => `${expectedPreflightUrl}&retry=1`; },
  (input) => { input.preflightRequest.method = () => "POST"; },
  (input) => { input.preflightRequestHeaders = { origin: "http://localhost:5173" }; },
  (input) => { input.preflightRequest.redirectedFrom = () => request("GET", expectedPreflightUrl); },
  (input) => { input.preflightResponseHeaders = { "access-control-allow-credentials": "true" }; },
  (input) => { input.preflightResponseHeaders = {
    "access-control-allow-origin": expectedStudioOrigin,
    "access-control-allow-credentials": "false"
  }; },
  (input) => { input.responseEvents[3].status = 204; },
  (input) => { input.responseByRequest.set(input.preflightRequest, {}); }
]) {
  const input = fixture({ preflight: true, preflightAbort: true });
  mutation(input);
  assert.throws(() => validate(input));
}
for (const property of ["preflightContractValidated", "preflightUiRendered"]) {
  const input = fixture({ preflight: true, preflightAbort: true });
  input[property] = false;
  assert.throws(() => validate(input), /requires/u);
}
{
  const input = fixture({ preflight: true, preflightAbort: true });
  input.responseEvents.push({ ...input.responseEvents[3], sequence: 5 });
  assert.throws(() => validate(input), /exactly one successful DuskDS preflight/u);
}
{
  const input = fixture({ preflight: true, preflightAbort: true });
  input.requestFailures.push({ ...input.requestFailures.at(-1), sequence: 9 });
  assert.throws(() => validate(input), /duplicate Chromium abort/u);
}
{
  const input = fixture({ preflight: true, preflightAbort: true });
  input.finishedRequests.set(input.preflightRequest, 9);
  assert.throws(() => validate(input), /must either finish/u);
}
{
  const input = fixture({ preflight: true, preflightAbort: true });
  const unrelatedRequest = request("GET", "http://127.0.0.1:5173/assets/app.js");
  input.requestFailures.push({
    request: unrelatedRequest,
    sequence: 9,
    text: "net::ERR_ABORTED",
    url: unrelatedRequest.url()
  });
  assert.throws(() => validate(input), /unexpected request failure/u);
}
{
  const input = fixture();
  input.preflightContractValidated = true;
  assert.throws(() => validate(input));
}

{
  const input = fixture({ probeAbort: true });
  input.requestFailures[0].sequence = 1;
  assert.throws(() => validate(input), /must either finish|unexpected request failure/u);
}
{
  const input = fixture({ probeAbort: true });
  input.requestFailures[0].request = request("GET", expectedProbeUrl);
  assert.throws(() => validate(input), /must either finish/u);
}
{
  const input = fixture({ healthAbort: true });
  input.requestFailures[0].sequence = 3;
  assert.throws(() => validate(input), /must either finish|unexpected request failure/u);
}
{
  const input = fixture({ healthAbort: true });
  input.requestFailures[0].request = request("GET", expectedProbeUrl);
  assert.throws(() => validate(input), /must either finish/u);
}
for (const mutation of [
  (input) => { input.requestFailures[0].text = "net::ERR_FAILED"; },
  (input) => { input.requestFailures[0].url = `${expectedProbeUrl}?retry=1`; },
  (input) => { input.healthRequest.url = () => `${expectedProbeUrl}?retry=1`; },
  (input) => { input.healthRequest.method = () => "POST"; },
  (input) => { input.responseEvents[2].status = 204; }
]) {
  const input = fixture({ healthAbort: true });
  mutation(input);
  assert.throws(() => validate(input));
}
{
  const input = fixture();
  input.responseEvents[2].sequence = 1;
  assert.throws(() => validate(input), /in order/u);
}
{
  const input = fixture();
  input.pairingValidated = false;
  assert.throws(() => validate(input), /only after the application validates/u);
}
{
  const input = fixture();
  input.responseEvents.push({ ...input.responseEvents[2], sequence: 4 });
  assert.throws(() => validate(input), /exactly one successful authenticated health/u);
}
{
  const input = fixture({ healthAbort: true });
  input.requestFailures.push({ ...input.requestFailures[0], sequence: 7 });
  assert.throws(() => validate(input), /duplicate Chromium abort/u);
}
{
  const input = fixture({ healthAbort: true });
  input.finishedRequests.set(input.healthRequest, 7);
  assert.throws(() => validate(input), /must either finish/u);
}
for (const [method, url] of [
  ["GET", "http://127.0.0.1:5173/assets/app.js"],
  ["GET", "http://127.0.0.1:5173/"],
  ["POST", "http://127.0.0.1:8788/scaffold-duskds-forge"]
]) {
  const input = fixture({ healthAbort: true });
  const unrelatedRequest = request(method, url);
  input.requestFailures.push({
    request: unrelatedRequest,
    sequence: 8,
    text: "net::ERR_ABORTED",
    url
  });
  assert.throws(() => validate(input), /unexpected request failure/u);
}

{
  const exactRequest = request("GET", expectedProbeUrl);
  const tracker = createRequestTerminalTracker({
    finishedRequests: new Map([[exactRequest, 1]]),
    requestFailures: [],
    timeoutMs: 20
  });
  await tracker.wait(exactRequest, "Already finished request");
}
{
  const exactRequest = request("GET", expectedProbeUrl);
  const tracker = createRequestTerminalTracker({
    finishedRequests: new Map(),
    requestFailures: [{
      request: exactRequest,
      sequence: 1,
      text: "net::ERR_ABORTED",
      url: expectedProbeUrl
    }],
    timeoutMs: 20
  });
  await tracker.wait(exactRequest, "Already failed request");
}
{
  const exactRequest = request("GET", expectedProbeUrl);
  const finishedRequests = new Map();
  const tracker = createRequestTerminalTracker({
    finishedRequests,
    requestFailures: [],
    timeoutMs: 50
  });
  const terminal = tracker.wait(exactRequest, "Later exact request");
  finishedRequests.set(exactRequest, 1);
  tracker.notify(exactRequest);
  await terminal;
}
{
  const exactRequest = request("GET", expectedProbeUrl);
  const unrelatedRequest = request("GET", expectedProbeUrl);
  const finishedRequests = new Map();
  const tracker = createRequestTerminalTracker({
    finishedRequests,
    requestFailures: [],
    timeoutMs: 50
  });
  let resolved = false;
  const terminal = tracker.wait(exactRequest, "Identity-bound request").then(() => {
    resolved = true;
  });
  finishedRequests.set(unrelatedRequest, 1);
  tracker.notify(unrelatedRequest);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(resolved, false);
  finishedRequests.set(exactRequest, 2);
  tracker.notify(exactRequest);
  await terminal;
}
{
  const firstRequest = request("POST", expectedBootstrapUrl);
  const secondRequest = request("GET", expectedProbeUrl);
  const finishedRequests = new Map();
  const tracker = createRequestTerminalTracker({
    finishedRequests,
    requestFailures: [],
    timeoutMs: 50
  });
  let firstResolved = false;
  const firstTerminal = tracker.wait(firstRequest, "First request").then(() => {
    firstResolved = true;
  });
  const secondTerminal = tracker.wait(secondRequest, "Second request");
  finishedRequests.set(secondRequest, 1);
  tracker.notify(secondRequest);
  await secondTerminal;
  assert.equal(firstResolved, false);
  finishedRequests.set(firstRequest, 2);
  tracker.notify(firstRequest);
  await firstTerminal;
}
{
  const exactRequest = request("GET", expectedProbeUrl);
  const finishedRequests = new Map();
  const tracker = createRequestTerminalTracker({
    finishedRequests,
    requestFailures: [],
    timeoutMs: 50
  });
  const terminal = tracker.wait(exactRequest, "Duplicate request");
  assert.throws(
    () => tracker.wait(exactRequest, "Duplicate request"),
    /already has a pending terminal-event wait/u
  );
  finishedRequests.set(exactRequest, 1);
  tracker.notify(exactRequest);
  await terminal;
}
{
  const exactRequest = request("GET", expectedProbeUrl);
  class EventDuringRegistrationMap extends Map {
    checks = 0;

    has(requestObject) {
      this.checks += 1;
      return this.checks > 1 && requestObject === exactRequest;
    }
  }
  const tracker = createRequestTerminalTracker({
    finishedRequests: new EventDuringRegistrationMap(),
    requestFailures: [],
    timeoutMs: 20
  });
  await tracker.wait(exactRequest, "Registration-race request");
}
{
  const exactRequest = request("GET", expectedProbeUrl);
  const tracker = createRequestTerminalTracker({
    finishedRequests: new Map(),
    requestFailures: [],
    timeoutMs: 10
  });
  await assert.rejects(
    tracker.wait(exactRequest, "Missing request"),
    /did not produce a terminal browser request event/u
  );
}

console.log("Npm package browser transport telemetry checks passed.");
