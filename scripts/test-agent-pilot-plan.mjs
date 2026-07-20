import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalAgentPilotPlan,
  canonicalSha256,
  validatePilotPlan
} from "./agent-pilot-collector.mjs";
import {
  isExpectedToolchainMismatch,
  isSafeModeMachineActionRefusal,
  materializeAgentPilotPlan,
  recoveryMarker
} from "./agent-pilot-plan.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planScript = path.join(productRoot, "scripts", "agent-pilot-plan.mjs");
const policy = JSON.parse(
  await fs.readFile(path.join(productRoot, "config", "phase5-policy.json"), "utf8")
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const candidate = {
  package_name: policy.npm_distribution.package_name,
  package_version: policy.npm_distribution.package_version,
  package_commit: "a".repeat(40),
  tarball_sha256: "b".repeat(64),
  npm_integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
  package_inventory_sha256: "c".repeat(64),
  candidate_artifact_fingerprint_sha256: "d".repeat(64)
};

const scenarios = policy.pilot.required_scenarios;
assert.equal(scenarios.length, 8);
assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 8);
assert.equal(new Set(scenarios.map((scenario) => scenario.capability)).size, 8);
assert.equal(new Set(scenarios.map((scenario) => scenario.failure_class)).size, 8);
assert.equal(
  isSafeModeMachineActionRefusal({
    status: 403,
    body: JSON.stringify({ ok: false, code: "capabilities_disabled" })
  }),
  true
);
assert.equal(
  isSafeModeMachineActionRefusal({
    status: 200,
    body: JSON.stringify({ ok: true, code: "capabilities_disabled" })
  }),
  false
);
assert.equal(
  isExpectedToolchainMismatch({
    status: 1,
    signal: null,
    stdout: "",
    stderr: "toolchain 'dusk-pilot-missing-toolchain' is not installed"
  }),
  true
);
assert.equal(
  isExpectedToolchainMismatch({
    status: 1,
    signal: null,
    stdout: "",
    stderr: "network unavailable"
  }),
  false
);
assert.equal(
  isExpectedToolchainMismatch({
    status: 0,
    signal: null,
    stdout: "cargo 1.94.0",
    stderr: ""
  }),
  false
);

const plans = scenarios.map((scenario) => {
  const first = materializeAgentPilotPlan(policy, scenario.id, candidate);
  const second = materializeAgentPilotPlan(policy, scenario.id, clone(candidate));
  assert.deepEqual(first, second, `${scenario.id} plan must be deterministic`);
  assert.deepEqual(
    first,
    buildCanonicalAgentPilotPlan(policy, scenario.id, candidate),
    `${scenario.id} materializer must use the collector-owned canonical plan`
  );
  assert.deepEqual(validatePilotPlan(policy, first), scenario);
  assert.equal(first.scenario_id, scenario.id);
  assert.equal(first.agent_confidence_score, 5);
  assert.equal(first.blocking_confusion, false);
  assert.equal(first.candidate.package_commit, candidate.package_commit);
  assert.equal(
    first.candidate.candidate_artifact_fingerprint_sha256,
    candidate.candidate_artifact_fingerprint_sha256
  );
  assert.equal(first.steps.at(-1).id, first.final_verification_step_id);
  assert.equal(first.steps.at(-1).role, "final-verification");
  assert.equal(first.steps.at(-1).kind, "hash-probe");
  assert.equal(first.steps.filter((step) => step.kind === "command").length, 3);
  assert.equal(first.steps.filter((step) => step.kind === "file-probe").length, 1);
  assert.equal(first.steps.filter((step) => step.kind === "hash-probe").length, 1);
  const controlledFailure = first.steps.filter((step) => step.role === "controlled-failure");
  assert.equal(controlledFailure.length, 1);
  assert.equal(controlledFailure[0].id, scenario.failure_class);
  assert.equal(controlledFailure[0].expect.outcome, "failure");
  assert.ok(first.steps.some((step) => step.role === "recovery"));
  for (const step of first.steps.filter((entry) => entry.kind === "command")) {
    assert.equal(step.command, "node");
    assert.equal(step.cwd, ".");
    assert.ok(step.args.every((argument) => !path.isAbsolute(argument)));
    assert.equal(step.args[0], "scripts/agent-pilot-plan.mjs");
    assert.equal(step.args[2], scenario.id);
  }
  const marker = recoveryMarker(scenario);
  const finalHash = first.steps.at(-1);
  const fileProbe = first.steps.find((step) => step.kind === "file-probe");
  assert.equal(finalHash.path, fileProbe.path);
  assert.equal(finalHash.expected_digest, sha256(Buffer.from(marker, "utf8")));
  assert.equal(fileProbe.expect.min_bytes, Buffer.byteLength(marker));
  assert.equal(fileProbe.expect.max_bytes, Buffer.byteLength(marker));
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 256 * 1024);
  return first;
});

assert.equal(
  new Set(plans.map((plan) => plan.steps[1].args.join("\0"))).size,
  scenarios.length,
  "each controlled-failure execution must bind its distinct scenario"
);
assert.equal(
  new Set(plans.map((plan) => plan.steps.at(-1).expected_digest)).size,
  scenarios.length,
  "each scenario must finish with a distinct recovery artifact"
);

const fakeEvalPlan = clone(plans[0]);
fakeEvalPlan.steps[0].args = ["-e", "process.exit(0)"];
assert.throws(
  () => validatePilotPlan(policy, fakeEvalPlan),
  /canonical scenario plan/u
);

const fixtureStepPlan = clone(plans[0]);
fixtureStepPlan.steps[1].args = [
  "scripts/agent-pilot-plan.mjs",
  "--fixture-step",
  "controlled-failure"
];
assert.throws(
  () => validatePilotPlan(policy, fixtureStepPlan),
  /canonical scenario plan/u
);

const alteredArgvPlan = clone(plans[0]);
alteredArgvPlan.steps[2].args[
  alteredArgvPlan.steps[2].args.indexOf("--phase") + 1
] = "controlled-failure";
assert.throws(
  () => validatePilotPlan(policy, alteredArgvPlan),
  /canonical scenario plan/u
);

const alteredTimeoutPlan = clone(plans[0]);
alteredTimeoutPlan.steps[0].timeout_ms -= 1;
assert.throws(
  () => validatePilotPlan(policy, alteredTimeoutPlan),
  /canonical scenario plan/u
);

assert.throws(
  () => materializeAgentPilotPlan(policy, "unknown-pilot", candidate),
  /eight reviewed scenarios/u
);

const extraCandidateField = { ...candidate, unexpected: true };
assert.throws(
  () => materializeAgentPilotPlan(policy, scenarios[0].id, extraCandidateField),
  /unexpected or missing fields/u
);

for (const [field, value, pattern] of [
  ["package_commit", "not-a-commit", /identity, commit, or artifact digests/u],
  ["tarball_sha256", "A".repeat(64), /identity, commit, or artifact digests/u],
  ["npm_integrity", "sha512-invalid", /identity, commit, or artifact digests/u],
  ["package_inventory_sha256", "e".repeat(63), /identity, commit, or artifact digests/u],
  ["candidate_artifact_fingerprint_sha256", "f".repeat(65), /identity, commit, or artifact digests/u]
]) {
  assert.throws(
    () => materializeAgentPilotPlan(
      policy,
      scenarios[0].id,
      { ...candidate, [field]: value }
    ),
    pattern
  );
}

assert.throws(
  () => materializeAgentPilotPlan(
    policy,
    scenarios[0].id,
    { ...candidate, package_version: "9.9.9" }
  ),
  /identity, commit, or artifact digests/u
);

const missingScenarioPolicy = clone(policy);
missingScenarioPolicy.pilot.required_scenarios.pop();
assert.throws(
  () => materializeAgentPilotPlan(
    missingScenarioPolicy,
    scenarios[0].id,
    candidate
  ),
  /exact eight reviewed pilot scenarios/u
);

const duplicateScenarioPolicy = clone(policy);
duplicateScenarioPolicy.pilot.required_scenarios[1] =
  clone(duplicateScenarioPolicy.pilot.required_scenarios[0]);
assert.throws(
  () => materializeAgentPilotPlan(
    duplicateScenarioPolicy,
    scenarios[0].id,
    candidate
  ),
  /exact eight reviewed pilot scenarios/u
);

const extraScenarioFieldPolicy = clone(policy);
extraScenarioFieldPolicy.pilot.required_scenarios[0].extra = true;
assert.throws(
  () => materializeAgentPilotPlan(
    extraScenarioFieldPolicy,
    scenarios[0].id,
    candidate
  ),
  /exact eight reviewed pilot scenarios/u
);

const duplicateCapabilityPolicy = clone(policy);
duplicateCapabilityPolicy.pilot.required_scenarios[1].capability =
  duplicateCapabilityPolicy.pilot.required_scenarios[0].capability;
assert.throws(
  () => materializeAgentPilotPlan(
    duplicateCapabilityPolicy,
    scenarios[0].id,
    candidate
  ),
  /exact eight reviewed pilot scenarios/u
);

const unsafeFailurePolicy = clone(policy);
unsafeFailurePolicy.pilot.required_scenarios[0].failure_class = "../escape";
assert.throws(
  () => materializeAgentPilotPlan(
    unsafeFailurePolicy,
    scenarios[0].id,
    candidate
  ),
  /exact eight reviewed pilot scenarios/u
);

const cliRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-agent-pilot-plan-"));
try {
  const cliScenario = scenarios.find(
    (scenario) => scenario.id === "linux-port-conflict-recovery"
  );
  assert.ok(cliScenario);
  const cliOutput = `output/pilots/plans/${cliScenario.id}.json`;
  const cliArguments = [
    "--scenario", cliScenario.id,
    "--package-name", candidate.package_name,
    "--package-version", candidate.package_version,
    "--package-commit", candidate.package_commit,
    "--tarball-sha256", candidate.tarball_sha256,
    "--npm-integrity", candidate.npm_integrity,
    "--package-inventory-sha256", candidate.package_inventory_sha256,
    "--phase5-fingerprint-sha256", candidate.candidate_artifact_fingerprint_sha256,
    "--output", cliOutput
  ];
  const stdout = execFileSync(process.execPath, [planScript, ...cliArguments], {
    cwd: cliRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const cliStatus = JSON.parse(stdout);
  assert.equal(cliStatus.status, "materialized");
  assert.equal(cliStatus.scenario_id, cliScenario.id);
  const cliPlan = JSON.parse(await fs.readFile(path.join(cliRoot, ...cliOutput.split("/")), "utf8"));
  assert.equal(cliStatus.plan_sha256, canonicalSha256(cliPlan));
  assert.deepEqual(
    cliPlan,
    materializeAgentPilotPlan(policy, cliScenario.id, candidate)
  );
  const overwriteAttempt = spawnSync(process.execPath, [planScript, ...cliArguments], {
    cwd: cliRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  assert.notEqual(overwriteAttempt.status, 0);
  assert.match(overwriteAttempt.stderr, /EEXIST|exist/iu);
  const unsafeOutputArguments = [...cliArguments];
  unsafeOutputArguments[unsafeOutputArguments.indexOf("--output") + 1] = "../escape.json";
  const unsafeOutput = spawnSync(process.execPath, [planScript, ...unsafeOutputArguments], {
    cwd: cliRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  assert.notEqual(unsafeOutput.status, 0);
  assert.match(unsafeOutput.stderr, /deterministic scenario path/u);

  const unsafeChainRoot = path.join(cliRoot, "unsafe-chain");
  await fs.mkdir(unsafeChainRoot);
  await fs.writeFile(path.join(unsafeChainRoot, "output"), "not a directory\n", "utf8");
  const unsafeChain = spawnSync(process.execPath, [planScript, ...cliArguments], {
    cwd: unsafeChainRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  assert.notEqual(unsafeChain.status, 0);
  assert.match(unsafeChain.stderr, /unsafe entry/u);
} finally {
  await fs.rm(cliRoot, { recursive: true, force: true });
}

process.stdout.write("Agent pilot plan tests passed.\n");
