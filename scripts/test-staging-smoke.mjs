import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers";
import { fetchAvailability, validatePublicHeaders, validateReleaseDocuments } from "./staging-smoke.mjs";

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
console.log("Phase 5 staging smoke fixtures passed.");
