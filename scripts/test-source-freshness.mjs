import assert from "node:assert/strict";
import { validateSourceFreshness } from "./check-source-freshness.mjs";

const coveredPaths = [
  "data/dusk/capabilities.json",
  "data/dusk/networks.evm.json",
  "data/dusk/resources.json",
  "data/dusk/troubleshooting.json"
];
const records = {
  "data/dusk/capabilities.json": [{ links: [{ url: "https://docs.dusk.network/developer/" }] }],
  "data/dusk/networks.evm.json": [{ rpcUrls: ["https://rpc.testnet.evm.dusk.network"], wssUrls: ["wss://wss.testnet.evm.dusk.network"] }],
  "data/dusk/resources.json": [{ url: "https://github.com/dusk-network/forge" }],
  "data/dusk/troubleshooting.json": [{}]
};
const valid = {
  schema_version: 3,
  status: "verified",
  reviewed_at: "2026-07-03",
  expires_at: "2026-08-03",
  policy: "fail-build",
  covered_files: coveredPaths.map((path) => ({ path, sha256: "a".repeat(64) })),
  sources: [{ id: "docs", url: "https://docs.dusk.network/", checked_at: "2026-07-03", status: "verified" }],
  provenance: {
    approved_hosts: ["docs.dusk.network", "rpc.testnet.evm.dusk.network", "wss.testnet.evm.dusk.network", "github.com"],
    record_counts: { capabilities: 1, networks: 1, resources: 1, troubleshooting: 1 }
  }
};

const validOptions = {
  now: new Date("2026-07-10T00:00:00Z"),
  fileHash: () => "a".repeat(64),
  readJson: (file) => records[file]
};

assert.deepEqual(validateSourceFreshness(valid, validOptions), {
  reviewedAt: "2026-07-03",
  expiresAt: "2026-08-03",
  sourceCount: 1,
  recordCount: 4
});
assert.throws(() => validateSourceFreshness(valid, { ...validOptions, now: new Date("2026-08-04T00:00:00Z") }), /expired/);
assert.throws(() => validateSourceFreshness(valid, { ...validOptions, now: new Date("invalid") }), /evaluation time is invalid/);
assert.throws(() => validateSourceFreshness({ ...valid, reviewed_at: "2026-07-11" }, validOptions), /future/);
assert.throws(() => validateSourceFreshness({ ...valid, status: "unreachable" }, validOptions), /not verified/);
assert.throws(() => validateSourceFreshness({ ...valid, sources: [{ ...valid.sources[0], status: "unreachable" }] }, validOptions), /not verified/);
assert.throws(() => validateSourceFreshness({ ...valid, sources: [{ ...valid.sources[0], checked_at: "2026-07-11" }] }, validOptions), /future/);
assert.throws(() => validateSourceFreshness(valid, { ...validOptions, fileExists: (file) => !file.endsWith("resources.json") }), /coverage is missing/);
assert.throws(() => validateSourceFreshness(valid, { ...validOptions, fileHash: (file) => file.endsWith("resources.json") ? "b".repeat(64) : "a".repeat(64) }), /content changed/);
assert.throws(() => validateSourceFreshness(valid, { ...validOptions, readJson: (file) => file.endsWith("resources.json") ? [{}, {}] : records[file] }), /record count changed/);
assert.throws(() => validateSourceFreshness(valid, { ...validOptions, readJson: (file) => file.endsWith("resources.json") ? [{ url: "https://example.com" }] : records[file] }), /unapproved host/);
console.log("Source freshness failure fixtures passed.");
