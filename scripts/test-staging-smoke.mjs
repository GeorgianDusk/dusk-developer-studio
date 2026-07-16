import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers";
import { URL } from "node:url";
import {
  ASSURANCE_CHECK_OWNERSHIP,
  checkPublicPortClosed,
  classifyAssuranceChecks,
  fetchAvailability,
  fetchStudioEvidence,
  selectAssuranceIncidentTitle,
  selectScheduledHeartbeatSignal,
  STUDIO_ASSURANCE_INCIDENT_TITLE,
  UPSTREAM_ASSURANCE_INCIDENT_TITLE,
  validateAssuranceTargetOrigin,
  validatePublicHeaders,
  validateReleaseDocuments,
  validateStudioEvidenceResponse
} from "./staging-smoke.mjs";

const headers = new globalThis.Headers({
  "cache-control": "no-cache",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; form-action 'none'",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()"
});
assert.deepEqual(validatePublicHeaders(headers, "html"), []);
const unsafeHeaders = new globalThis.Headers(headers);
unsafeHeaders.set("content-security-policy", "default-src 'self'; connect-src http://127.0.0.1:8788");
assert.match(validatePublicHeaders(unsafeHeaders, "html").join("\n"), /local companion|frame\/form/);
assert.match(validatePublicHeaders(new globalThis.Headers({ "cache-control": "max-age=60" }), "receipt").join("\n"), /no-store/);

const assurance = { schema_version: 1, assets: { status: "passed" }, deployment_headers: { status: "passed" }, source_links_and_schema: { status: "passed" } };
const { createHash } = await import("node:crypto");
const assuranceDigest = createHash("sha256").update(Buffer.from(JSON.stringify(assurance, null, 2) + "\n")).digest("hex");
const manifest = {
  schema_version: 2,
  product: "Dusk Developer Studio",
  commit: "a".repeat(40),
  environment: "staging",
  assurance: { dependency_audit: "passed", secret_scan: "passed", browser_matrix: "passed", source_access: "passed", live_smoke: "not-run" },
  assurance_receipt_sha256: assuranceDigest,
  artifacts: [{ path: "index.html", sha256: "b".repeat(64), bytes: 5 }]
};
assert.match(validateReleaseDocuments(manifest, assurance, { expectedEnvironment: "staging", expectedCommit: "c".repeat(40) }).join("\n"), /Release commit is/);
assert.deepEqual(validateReleaseDocuments(manifest, assurance, { expectedEnvironment: "staging" }), []);
assert.match(validateReleaseDocuments({ ...manifest, commit: `${"a".repeat(40)}-dirty` }, assurance, { expectedEnvironment: "staging" }).join("\n"), /clean full Git commit/);
assert.match(validateReleaseDocuments({ ...manifest, assurance: { ...manifest.assurance, source_access: "not-run" } }, assurance, { expectedEnvironment: "staging" }).join("\n"), /source_access/);
let syntheticHeaders;
const fakeGet = (_url, options, callback) => {
  syntheticHeaders = new globalThis.Headers(options.headers);
  const request = new EventEmitter();
  request.setTimeout = () => request;
  request.destroy = (error) => { if (error) setImmediate(() => request.emit("error", error)); };
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = {};
  response.resume = () => response;
  setImmediate(() => callback(response));
  return request;
};
assert.equal(await fetchAvailability("https://docs.dusk.network/developer/overview/", 1_000, fakeGet), 200);
assert.match(syntheticHeaders.get("user-agent"), /^DuskStudioSynthetic\/1\.0/);

const closedConnect = () => {
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.destroy = () => undefined;
  setImmediate(() => socket.emit("error", Object.assign(new Error("closed"), { code: "ECONNREFUSED" })));
  return socket;
};
assert.deepEqual(await checkPublicPortClosed("studio.example", 5173, closedConnect), { status: "passed", observed: "econnrefused" });

const openConnect = () => {
  const socket = new EventEmitter();
  socket.setTimeout = () => socket;
  socket.destroy = () => undefined;
  setImmediate(() => socket.emit("connect"));
  return socket;
};
await assert.rejects(checkPublicPortClosed("studio.example", 8788, openConnect), /8788 accepted/);

const targetPolicy = { candidate_hosts: ["studio.example"] };
assert.equal(validateAssuranceTargetOrigin("https://studio.example", targetPolicy).href, "https://studio.example/");
assert.equal(validateAssuranceTargetOrigin("https://studio.example:443/", targetPolicy).href, "https://studio.example/");
for (const [target, pattern] of [
  ["http://studio.example/", /HTTPS/],
  ["https://user@studio.example/", /user information/],
  ["https://studio.example:8443/", /default HTTPS port/],
  ["https://studio.example/path", /exact origin/],
  ["https://studio.example/?query=1", /exact origin/],
  ["https://studio.example/#fragment", /exact origin/],
  ["https://other.example/", /not approved/]
]) assert.throws(() => validateAssuranceTargetOrigin(target, targetPolicy), pattern);

const approvedOrigin = new URL("https://studio.example/");
let observedRedirectMode;
const exactEvidence = await fetchStudioEvidence(approvedOrigin, "/healthz", {}, async (target, options) => {
  observedRedirectMode = options.redirect;
  return { response: { status: 200, url: target.href, redirected: false }, body: Buffer.from("ok") };
});
assert.equal(observedRedirectMode, "manual");
assert.equal(exactEvidence.body.toString("utf8"), "ok");
assert.doesNotThrow(() => validateStudioEvidenceResponse("https://studio.example/healthz", approvedOrigin.origin, { status: 200, url: "https://studio.example/healthz", redirected: false }));
assert.throws(() => validateStudioEvidenceResponse("https://studio.example/healthz", approvedOrigin.origin, { status: 302, url: "https://studio.example/healthz", redirected: false }), /must not follow or accept redirects/);
assert.throws(() => validateStudioEvidenceResponse("https://studio.example/healthz", approvedOrigin.origin, { status: 200, url: "https://studio.example/healthz", redirected: true }), /must not follow or accept redirects/);
assert.throws(() => validateStudioEvidenceResponse("https://studio.example/healthz", approvedOrigin.origin, { status: 200, url: "https://other.example/healthz", redirected: false }), /exact requested origin and URL/);
assert.throws(() => validateStudioEvidenceResponse("https://studio.example/healthz", approvedOrigin.origin, { status: 200, url: "https://studio.example/other", redirected: false }), /exact requested origin and URL/);
await assert.rejects(fetchStudioEvidence(approvedOrigin, "//other.example/healthz", {}, async () => { throw new Error("must not fetch"); }), /escapes the approved origin/);

const passingChecks = Object.fromEntries([
  "public_health", "key_routes", "release_parity", "source_links", "rpc_chain_id",
  "rpc_degradation", "tls_expiry", "development_port_closed", "companion_port_closed"
].map((name) => [name, { status: "passed" }]));
assert.deepEqual(Object.keys(ASSURANCE_CHECK_OWNERSHIP).sort(), Object.keys(passingChecks).sort());
assert.ok(Object.values(ASSURANCE_CHECK_OWNERSHIP).every((owner) => owner === "studio" || owner === "upstream"));
assert.deepEqual(classifyAssuranceChecks(passingChecks), { studio_status: "passed", upstream_dependency_status: "passed" });
const sourceFailure = classifyAssuranceChecks({ ...passingChecks, source_links: { status: "failed" } });
const rpcFailure = classifyAssuranceChecks({ ...passingChecks, rpc_chain_id: { status: "failed" } });
const mixedFailure = classifyAssuranceChecks({ ...passingChecks, public_health: { status: "failed" }, rpc_chain_id: { status: "failed" } });
assert.deepEqual(sourceFailure, { studio_status: "passed", upstream_dependency_status: "failed" });
assert.deepEqual(rpcFailure, { studio_status: "passed", upstream_dependency_status: "failed" });
assert.deepEqual(mixedFailure, { studio_status: "failed", upstream_dependency_status: "failed" });
assert.deepEqual(classifyAssuranceChecks({ ...passingChecks, public_health: { status: "failed" } }), { studio_status: "failed", upstream_dependency_status: "passed" });
assert.deepEqual(classifyAssuranceChecks({ ...passingChecks, future_check: { status: "failed" } }), { studio_status: "failed", upstream_dependency_status: "passed" });
assert.deepEqual(classifyAssuranceChecks({ ...passingChecks, future_check: { status: "passed" } }), { studio_status: "passed", upstream_dependency_status: "passed" });
const checksMissingStudio = { ...passingChecks };
delete checksMissingStudio.public_health;
assert.deepEqual(classifyAssuranceChecks(checksMissingStudio), { studio_status: "failed", upstream_dependency_status: "passed" });
const checksMissingUpstream = { ...passingChecks };
delete checksMissingUpstream.source_links;
assert.deepEqual(classifyAssuranceChecks(checksMissingUpstream), { studio_status: "passed", upstream_dependency_status: "failed" });
assert.equal(selectAssuranceIncidentTitle("success", "failure", sourceFailure), UPSTREAM_ASSURANCE_INCIDENT_TITLE);
assert.equal(selectAssuranceIncidentTitle("success", "failure", rpcFailure), UPSTREAM_ASSURANCE_INCIDENT_TITLE);
assert.equal(selectAssuranceIncidentTitle("failure", "failure", rpcFailure), STUDIO_ASSURANCE_INCIDENT_TITLE);
assert.equal(selectAssuranceIncidentTitle("success", "success", rpcFailure), STUDIO_ASSURANCE_INCIDENT_TITLE);
assert.equal(selectAssuranceIncidentTitle("success", "failure", mixedFailure), STUDIO_ASSURANCE_INCIDENT_TITLE);
assert.equal(selectAssuranceIncidentTitle("success", "failure", { studio_status: "unknown", upstream_dependency_status: "failed" }), STUDIO_ASSURANCE_INCIDENT_TITLE);
const passingClassification = classifyAssuranceChecks(passingChecks);
assert.equal(selectScheduledHeartbeatSignal("success", "success", passingClassification), "success");
assert.equal(selectScheduledHeartbeatSignal("failure", "success", passingClassification), "failure");
assert.equal(selectScheduledHeartbeatSignal("success", "failure", passingClassification), "failure");
assert.equal(selectScheduledHeartbeatSignal("skipped", "skipped", passingClassification), "failure");
assert.equal(selectScheduledHeartbeatSignal("success", "success", sourceFailure), "failure");
assert.equal(selectScheduledHeartbeatSignal("success", "success", { studio_status: "unknown", upstream_dependency_status: "passed" }), "failure");
console.log("Phase 5 staging smoke fixtures passed.");
