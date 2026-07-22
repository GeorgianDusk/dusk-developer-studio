import assert from "node:assert/strict";
import { setTimeout } from "node:timers";
import {
  createRequestTerminalTracker,
  validateBrowserTransportEvidence
} from "./npm-package-browser-telemetry.mjs";

const expectedProbeUrl = "http://127.0.0.1:5173/__dusk/session";
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

function response(requestObject, headers = {}, {
  status = 200,
  url = requestObject.url()
} = {}) {
  return {
    headers: () => headers,
    request: () => requestObject,
    status: () => status,
    url: () => url
  };
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
      status: 200,
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
  const requestEvents = [
    { request: probeRequest, url: expectedProbeUrl },
    { request: bootstrapRequest, url: expectedBootstrapUrl },
    { request: healthRequest, url: expectedProbeUrl }
  ];
  const responseByRequest = new Map([
    [probeRequest, probeResponse],
    [bootstrapRequest, bootstrapResponse],
    [healthRequest, healthResponse]
  ]);
  if (preflight) {
    requestEvents.push({ request: preflightRequest, url: expectedPreflightUrl });
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
    requestEvents,
    requestFailures,
    responseByRequest,
    responseEvents
  };
}

function validate(input) {
  return validateBrowserTransportEvidence(input);
}

for (const [options, telemetry] of [
  [{}, { unpaired_session: 0, paired_session: 0, bootstrap: 0, preflight: 0 }],
  [{ probeAbort: true }, { unpaired_session: 1, paired_session: 0, bootstrap: 0, preflight: 0 }],
  [{ healthAbort: true }, { unpaired_session: 0, paired_session: 1, bootstrap: 0, preflight: 0 }],
  [{ bootstrapAbort: true }, { unpaired_session: 0, paired_session: 0, bootstrap: 1, preflight: 0 }],
  [
    { bootstrapAbort: true, healthAbort: true, probeAbort: true },
    { unpaired_session: 1, paired_session: 1, bootstrap: 1, preflight: 0 }
  ],
  [
    { preflight: true },
    { unpaired_session: 0, paired_session: 0, bootstrap: 0, preflight: 0 }
  ],
  [
    { preflight: true, preflightAbort: true },
    { unpaired_session: 0, paired_session: 0, bootstrap: 0, preflight: 1 }
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
  assert.throws(() => validate(input), /exactly one DuskDS preflight response/u);
}
{
  const input = fixture();
  const forbiddenRequest = request("GET", expectedPreflightUrl);
  input.requestEvents.push({ request: forbiddenRequest, url: expectedPreflightUrl });
  assert.throws(() => validate(input), /Safe mode cannot issue any/u);
}
{
  const input = fixture();
  const forbiddenRequest = request("GET", expectedPreflightUrl);
  const forbiddenResponse = response(forbiddenRequest);
  input.requestEvents.push({ request: forbiddenRequest, url: expectedPreflightUrl });
  input.responseEvents.push({
    request: forbiddenRequest,
    response: forbiddenResponse,
    sequence: 4,
    status: 204,
    url: expectedPreflightUrl
  });
  input.responseByRequest.set(forbiddenRequest, forbiddenResponse);
  input.finishedRequests.set(forbiddenRequest, 8);
  assert.throws(() => validate(input), /Safe mode cannot issue any/u);
}
for (const [url, status] of [
  [`${expectedPreflightUrl}&retry=1`, 204],
  ["http://127.0.0.1:8788/preflight?path=%64uskds", 200],
  ["http://localhost:8788/preflight?path=duskds", 204]
]) {
  const input = fixture();
  const forbiddenRequest = request("GET", url);
  const forbiddenResponse = response(forbiddenRequest);
  input.requestEvents.push({ request: forbiddenRequest, url });
  input.responseEvents.push({
    request: forbiddenRequest,
    response: forbiddenResponse,
    sequence: 4,
    status,
    url
  });
  input.responseByRequest.set(forbiddenRequest, forbiddenResponse);
  input.finishedRequests.set(forbiddenRequest, 8);
  assert.throws(() => validate(input), /Safe mode cannot issue any/u);
}
for (const method of ["GET", "POST"]) {
  const input = fixture({ preflight: true, preflightAbort: true });
  const duplicateRequest = request(method, expectedPreflightUrl);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url: expectedPreflightUrl });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 5,
    status: 204,
    url: expectedPreflightUrl
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 10);
  assert.throws(() => validate(input), /exactly one DuskDS preflight request|exactly one DuskDS preflight response/u);
}
for (const url of [
  `${expectedPreflightUrl}&retry=1`,
  "http://127.0.0.1:8788/preflight?path=%64uskds",
  "http://localhost:8788/preflight?path=duskds"
]) {
  const input = fixture({ preflight: true, preflightAbort: true });
  const duplicateRequest = request("GET", url);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 5,
    status: 200,
    url
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 10);
  assert.throws(() => validate(input), /exactly one DuskDS preflight request|exactly one DuskDS preflight response/u);
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
  assert.throws(() => validate(input), /only after the application renders/u);
}
for (const property of ["probeRequest", "bootstrapRequest", "healthRequest"]) {
  const input = fixture();
  input[property].redirectedFrom = () => request("GET", "http://127.0.0.1:8788/redirect-source");
  assert.throws(() => validate(input), /cannot follow a redirect/u);
}
{
  const input = fixture();
  input.responseEvents.push({ ...input.responseEvents[2], sequence: 4 });
  assert.throws(() => validate(input), /exactly two session-status responses/u);
}
{
  const input = fixture();
  const url = `${expectedProbeUrl}?retry=1`;
  const duplicateRequest = request("GET", url);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 4,
    status: 200,
    url
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 8);
  assert.throws(() => validate(input), /exactly two session-status responses/u);
}
{
  const input = fixture();
  const url = "http://localhost:5173/__dusk/session";
  const duplicateRequest = request("GET", url);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 4,
    status: 200,
    url
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 8);
  assert.throws(() => validate(input), /exactly two session-status responses/u);
}
{
  const input = fixture();
  const url = "http://127.0.0.1:5173/__dusk/session?duplicate=1";
  const duplicateRequest = request("GET", url);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 4,
    status: 200,
    url
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 8);
  assert.throws(() => validate(input), /exactly two session-status responses/u);
}
{
  const input = fixture();
  const url = "http://localhost:5173/__dusk/bootstrap";
  const duplicateRequest = request("POST", url);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 4,
    status: 200,
    url
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 8);
  assert.throws(() => validate(input), /exactly one bootstrap response/u);
}
{
  const input = fixture();
  input.requestEvents[0] = { request: request("GET", expectedProbeUrl), url: expectedProbeUrl };
  input.requestEvents[2] = { request: request("GET", expectedProbeUrl), url: expectedProbeUrl };
  assert.throws(() => validate(input), /bijectively reference-bound/u);
}
{
  const input = fixture();
  input.requestEvents[0] = {
    request: { ...input.requestEvents[0].request },
    url: expectedProbeUrl
  };
  input.requestEvents[2] = {
    request: { ...input.requestEvents[2].request },
    url: expectedProbeUrl
  };
  assert.throws(() => validate(input), /bijectively reference-bound/u);
}
{
  const input = fixture();
  input.requestEvents[1] = {
    request: { ...input.requestEvents[1].request },
    url: expectedBootstrapUrl
  };
  assert.throws(() => validate(input), /bijectively reference-bound/u);
}
{
  const input = fixture();
  input.requestEvents[2] = { request: input.probeRequest, url: expectedProbeUrl };
  input.responseEvents[2].request = input.probeRequest;
  input.responseEvents[2].response = input.responseEvents[0].response;
  assert.throws(() => validate(input), /distinct Request objects|distinct Response objects/u);
}
{
  const input = fixture();
  input.responseEvents[0].response.request = () => request("GET", expectedProbeUrl);
  assert.throws(() => validate(input), /Response must point back/u);
}
for (const mutation of [
  (input) => { input.responseEvents[0].response.url = () => "http://attacker.invalid/health"; },
  (input) => { input.responseEvents[0].response.status = () => 599; }
]) {
  const input = fixture();
  mutation(input);
  assert.throws(() => validate(input), /Response URL must match|Response status must match/u);
}
{
  const input = fixture();
  const duplicateRequest = request("GET", expectedProbeUrl);
  const duplicateResponse = response(duplicateRequest);
  input.requestEvents.push({ request: duplicateRequest, url: expectedProbeUrl });
  input.responseEvents.push({
    request: duplicateRequest,
    response: duplicateResponse,
    sequence: 4,
    status: 204,
    url: expectedProbeUrl
  });
  input.responseByRequest.set(duplicateRequest, duplicateResponse);
  input.finishedRequests.set(duplicateRequest, 8);
  assert.throws(() => validate(input), /exactly two session-status responses/u);
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
