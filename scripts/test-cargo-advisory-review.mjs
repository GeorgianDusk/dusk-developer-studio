import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import {
  parseCargoAuditExecution,
  validateCargoAdvisoryReview
} from "./cargo-advisory-review-core.mjs";

const root = process.cwd();
const policy = JSON.parse(
  fs.readFileSync(path.join(root, "config", "cargo-advisory-review.json"), "utf8")
);
const lockBytes = fs.readFileSync(path.join(root, ...policy.lock_path.split("/")));
const now = new Date("2026-08-10T09:00:00.000Z");
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
  const vulnerabilities = policy.accepted_vulnerabilities.map((record) => ({
    package: { name: record.package, version: record.version },
    advisory: { id: record.advisory_id }
  }));
  return {
    database: {
      "advisory-count": 1166,
      "last-commit": "b".repeat(40),
      "last-updated": "2026-08-10T08:00:00.000Z"
    },
    lockfile: { "dependency-count": policy.lock_dependency_count },
    settings: {
      target_arch: [],
      target_os: [],
      severity: null,
      ignore: [],
      informational_warnings: ["unmaintained", "unsound", "notice"]
    },
    vulnerabilities: {
      found: vulnerabilities.length > 0,
      count: vulnerabilities.length,
      list: vulnerabilities
    },
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
  reviewed_vulnerability_count: 1,
  reviewed_warning_count: 5,
  status: "passed"
});

{
  const report = reportFixture();
  report.vulnerabilities.list.push({
    package: { name: "new-vulnerability", version: "1.0.0" },
    advisory: { id: "RUSTSEC-2026-9999" }
  });
  report.vulnerabilities.count += 1;
  assert.throws(() => validate({ report }), /vulnerability set changed/u);
}
{
  const report = reportFixture();
  report.vulnerabilities.list.pop();
  report.vulnerabilities.count = 0;
  report.vulnerabilities.found = false;
  assert.throws(() => validate({ report }), /vulnerability set changed/u);
}
{
  const report = reportFixture();
  report.vulnerabilities.list[0].package.version = "0.7.47";
  assert.throws(() => validate({ report }), /vulnerability set changed/u);
}
{
  const report = reportFixture();
  report.vulnerabilities.list.push(clone(report.vulnerabilities.list[0]));
  report.vulnerabilities.count += 1;
  assert.throws(() => validate({ report }), /duplicate vulnerability identities/u);
}
{
  const report = reportFixture();
  report.vulnerabilities.count = 2;
  assert.throws(() => validate({ report }), /vulnerability summary is malformed/u);
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
  const duplicatePolicy = clone(policy);
  duplicatePolicy.accepted_vulnerabilities.push(
    clone(duplicatePolicy.accepted_vulnerabilities[0])
  );
  assert.throws(() => validate({ policy: duplicatePolicy }), /duplicate identities/u);
}
{
  const unownedPolicy = clone(policy);
  unownedPolicy.accepted_informational_warnings[0].owner = "";
  assert.throws(() => validate({ policy: unownedPolicy }), /review owner/u);
}
{
  const unownedPolicy = clone(policy);
  unownedPolicy.accepted_vulnerabilities[0].owner = "";
  assert.throws(() => validate({ policy: unownedPolicy }), /review owner/u);
}
{
  const unmitigatedPolicy = clone(policy);
  unmitigatedPolicy.accepted_vulnerabilities[0].mitigation = "";
  assert.throws(() => validate({ policy: unmitigatedPolicy }), /mitigation/u);
}

{
  const report = reportFixture();
  assert.deepEqual(parseCargoAuditExecution({
    error: undefined,
    signal: null,
    status: 1,
    stderr: "",
    stdout: JSON.stringify(report)
  }), report);
  assert.throws(() => parseCargoAuditExecution({
    error: undefined,
    signal: null,
    status: 0,
    stderr: "",
    stdout: JSON.stringify(report)
  }), /exit status does not match/u);
  assert.throws(() => parseCargoAuditExecution({
    error: undefined,
    signal: null,
    status: 2,
    stderr: "",
    stdout: JSON.stringify(report)
  }), /did not complete successfully/u);
  assert.throws(() => parseCargoAuditExecution({
    error: undefined,
    signal: null,
    status: 1,
    stderr: "fatal: database update failed",
    stdout: JSON.stringify(report)
  }), /incomplete database/u);
  assert.throws(() => parseCargoAuditExecution({
    error: undefined,
    signal: null,
    status: 1,
    stderr: "",
    stdout: "not-json"
  }), /malformed JSON/u);
}

console.log("Cargo advisory review policy and fail-closed report checks passed.");
