import assert from "node:assert/strict";
import { validatePairingTransportEvidence } from "./npm-package-browser-telemetry.mjs";

const expectedProbeUrl = "http://127.0.0.1:8788/health";
const expectedBootstrapUrl = "http://127.0.0.1:5173/__dusk/bootstrap";

function request(method, url) {
  return { method: () => method, url: () => url };
}

function fixture({ bootstrapAbort = false, healthAbort = false } = {}) {
  const probeRequest = request("GET", expectedProbeUrl);
  const bootstrapRequest = request("POST", expectedBootstrapUrl);
  const healthRequest = request("GET", expectedProbeUrl);
  const probeResponse = {};
  const bootstrapResponse = {};
  const healthResponse = {};
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
  const requestFailures = [];
  const finishedRequests = new Map([[probeRequest, 4]]);
  let sequence = 5;
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
  return {
    bootstrapRequest,
    expectedBootstrapUrl,
    expectedProbeUrl,
    finishedRequests,
    healthRequest,
    pairingValidated: true,
    probeRequest,
    requestFailures,
    responseByRequest,
    responseEvents
  };
}

function validate(input) {
  return validatePairingTransportEvidence(input);
}

for (const [options, telemetry] of [
  [{}, { authenticated_health: 0, bootstrap: 0 }],
  [{ healthAbort: true }, { authenticated_health: 1, bootstrap: 0 }],
  [{ bootstrapAbort: true }, { authenticated_health: 0, bootstrap: 1 }],
  [{ bootstrapAbort: true, healthAbort: true }, { authenticated_health: 1, bootstrap: 1 }]
]) {
  assert.deepEqual(validate(fixture(options)).lateAbortTelemetry, telemetry);
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

console.log("Npm package browser transport telemetry checks passed.");
