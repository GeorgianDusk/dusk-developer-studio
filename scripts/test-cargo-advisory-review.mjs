import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { validateCargoAdvisoryReview } from "./cargo-advisory-review-core.mjs";

const root = process.cwd();
const policy = JSON.parse(
  fs.readFileSync(path.join(root, "config", "cargo-advisory-review.json"), "utf8")
);
const lockBytes = fs.readFileSync(path.join(root, ...policy.lock_path.split("/")));
const now = new Date("2026-07-21T00:00:00.000Z");
const clone = (value) => JSON.parse(JSON.stringify(value));

function reportFixture() {
  const warnings = {};
  for (const record of policy.accepted_informational_warnings) {
    warnings[record.kind] ??= [];
    warnings[record.kind].push({
      kind: record.kind,
      package: { name: record.package, version: record.version },
      advisory: { id: record.advisory_id }
    });
  }
  return {
    database: {
      "advisory-count": 1166,
      "last-commit": "b".repeat(40),
      "last-updated": "2026-07-20T00:00:00.000Z"
    },
    lockfile: { "dependency-count": policy.lock_dependency_count },
    settings: {
      target_arch: [],
      target_os: [],
      severity: null,
      ignore: [],
      informational_warnings: ["unmaintained", "unsound", "notice"]
    },
    vulnerabilities: { found: false, count: 0, list: [] },
    warnings
  };
}

function validate(overrides = {}) {
  return validateCargoAdvisoryReview({
    lockBytes,
    now,
    policy,
    report: reportFixture(),
    scannerVersion: "cargo-audit 0.22.2",
    ...overrides
  });
}

assert.deepEqual(validate(), {
  advisory_database_commit: "b".repeat(40),
  advisory_database_count: 1166,
  dependency_count: 277,
  reviewed_warning_count: 5,
  status: "passed"
});

{
  const report = reportFixture();
  report.vulnerabilities = {
    found: true,
    count: 1,
    list: [{ advisory: { id: "RUSTSEC-2026-9999" } }]
  };
  assert.throws(() => validate({ report }), /reported a dependency vulnerability/u);
}
{
  const report = reportFixture();
  report.warnings.unsound.push({
    kind: "unsound",
    package: { name: "new-warning", version: "1.0.0" },
    advisory: { id: "RUSTSEC-2026-9999" }
  });
  assert.throws(() => validate({ report }), /warning set changed/u);
}
{
  const report = reportFixture();
  report.warnings.unmaintained.pop();
  assert.throws(() => validate({ report }), /warning set changed/u);
}
{
  const report = reportFixture();
  report.warnings.unsound[0].package.version = "0.7.2";
  assert.throws(() => validate({ report }), /warning set changed/u);
}
{
  const report = reportFixture();
  report.warnings.unsound.push({ ...report.warnings.unsound[0] });
  assert.throws(() => validate({ report }), /duplicate warning identities/u);
}
{
  const report = reportFixture();
  report.database["last-updated"] = "2026-05-01T00:00:00.000Z";
  assert.throws(() => validate({ report }), /database is stale/u);
}
{
  const report = reportFixture();
  report.settings.ignore = ["RUSTSEC-2026-9999"];
  assert.throws(() => validate({ report }), /filter or ignore/u);
}
{
  const report = reportFixture();
  report.settings.severity = "high";
  assert.throws(() => validate({ report }), /filter or ignore/u);
}
{
  const report = reportFixture();
  report.settings.target_os = ["linux"];
  assert.throws(() => validate({ report }), /filter or ignore/u);
}
assert.throws(
  () => validate({ scannerVersion: "cargo-audit 0.22.1" }),
  /scanner identity/u
);
assert.throws(
  () => validate({ lockBytes: Buffer.concat([lockBytes, Buffer.from("\n")]) }),
  /not bound to the current lockfile/u
);
assert.throws(
  () => validate({ now: new Date("2026-08-21T00:00:00.000Z") }),
  /review expired/u
);
{
  const duplicatePolicy = clone(policy);
  duplicatePolicy.accepted_informational_warnings.push(
    clone(duplicatePolicy.accepted_informational_warnings[0])
  );
  assert.throws(() => validate({ policy: duplicatePolicy }), /duplicate identities/u);
}
{
  const unownedPolicy = clone(policy);
  unownedPolicy.accepted_informational_warnings[0].owner = "";
  assert.throws(() => validate({ policy: unownedPolicy }), /review owner/u);
}

console.log("Cargo advisory review policy and fail-closed report checks passed.");
