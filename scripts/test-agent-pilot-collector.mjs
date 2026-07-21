import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  buildCanonicalAgentPilotPlan,
  canonicalJson,
  canonicalPilotRecoveryMarker,
  canonicalSha256,
  collectAgentPilot,
  validatePilotPlan,
  verifyAgentPilotResult
} from "./agent-pilot-collector.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(productRoot, "config", "phase5-policy.json");
const policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-agent-pilot-test-"));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function integrity(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function writeTarString(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  assert.ok(bytes.length <= length);
  bytes.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const octal = value.toString(8).padStart(length - 1, "0");
  assert.ok(octal.length <= length - 1);
  writeTarString(header, offset, length, `${octal}\0`);
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");
  writeTarString(header, 265, 32, "root");
  writeTarString(header, 297, 32, "root");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function createTar(files) {
  const chunks = [];
  for (const [name, content] of files) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    chunks.push(tarHeader(`package/${name}`, bytes.length), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function createFixtureTarball(file, commit, overrides = {}) {
  const packageName = "dusk-developer-studio";
  const packageVersion = policy.npm_distribution.package_version;
  const ordinaryFiles = new Map([
    ["fixture.txt", Buffer.from("fixture candidate\n", "utf8")],
    [
      "package.json",
      Buffer.from(`${JSON.stringify({
        name: packageName,
        version: packageVersion,
        type: "module"
      })}\n`, "utf8")
    ]
  ]);
  const manifestFiles = [...ordinaryFiles.entries()]
    .map(([filePath, bytes]) => ({
      path: filePath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes)
    }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const manifest = {
    schema_version: 1,
    package: packageName,
    version: packageVersion,
    commit,
    files: manifestFiles,
    ...overrides.manifest
  };
  const allFiles = [
    ...ordinaryFiles.entries(),
    ["package-manifest.json", Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8")]
  ].sort((left, right) => left[0].localeCompare(right[0], "en"));
  const bytes = gzipSync(createTar(allFiles), { mtime: 0 });
  await fs.writeFile(file, bytes);
  return {
    package_name: packageName,
    package_version: packageVersion,
    package_commit: commit,
    tarball_sha256: sha256(bytes),
    npm_integrity: integrity(bytes),
    package_inventory_sha256: canonicalSha256(manifestFiles),
    candidate_artifact_fingerprint_sha256: "f".repeat(64)
  };
}

function git(repository, args) {
  return execFileSync(
    "git",
    ["-c", `safe.directory=${repository}`, "-C", repository, ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  ).trim();
}

function scenarioForCurrentPlatform() {
  if (process.platform === "win32") return "win-overwrite-refusal";
  if (process.platform === "darwin") return "macos-privilege-recovery";
  if (process.env.WSL_DISTRO_NAME || /microsoft/iu.test(os.release())) {
    return "wsl-native-toolchain-recovery";
  }
  return "linux-port-conflict-recovery";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rebindResultWrapper(result) {
  const receiptJson = canonicalJson(result.receipt);
  const receiptSha256 = canonicalSha256(result.receipt);
  result.receipt_sha256 = receiptSha256;
  result.phase5_embedding_summary.receipt_sha256 = receiptSha256;
  result.phase5_embedding_summary.receipt_json = receiptJson;
  result.phase5_embedding_summary.recovery_evidence_reference =
    `agent-pilots/${result.receipt.scenario.id}/${result.receipt.execution.raw_observation_bundle_sha256}.recovery.json`;
  result.phase5_embedding_summary.session_record_reference =
    `agent-pilots/${result.receipt.scenario.id}/${receiptSha256}.json`;
  result.github_actions_provenance_output.collector_receipt_sha256 = receiptSha256;
  result.github_actions_provenance_output.raw_observation_bundle_sha256 =
    result.receipt.execution.raw_observation_bundle_sha256;
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function expectReject(action, pattern) {
  await assert.rejects(action, pattern);
}

try {
  const collectorRepository = path.join(temporaryRoot, "collector-repository");
  const collectorScript = path.join(
    collectorRepository,
    "scripts",
    "agent-pilot-collector.mjs"
  );
  await fs.mkdir(path.dirname(collectorScript), { recursive: true });
  await fs.writeFile(collectorScript, "export const fixtureCollector = true;\n", "utf8");
  git(collectorRepository, ["init"]);
  git(collectorRepository, ["add", "scripts/agent-pilot-collector.mjs"]);
  git(collectorRepository, [
    "-c",
    "user.name=Pilot Collector Test",
    "-c",
    "user.email=pilot-collector@example.invalid",
    "commit",
    "-m",
    "Add fixture collector"
  ]);
  const commit = git(collectorRepository, ["rev-parse", "HEAD"]).toLowerCase();
  assert.match(commit, /^[a-f0-9]{40}$/u);

  const workspace = path.join(temporaryRoot, "workspace");
  await fs.mkdir(path.join(workspace, "scripts"), { recursive: true });
  await fs.mkdir(path.join(workspace, "output", "pilots", "package"), {
    recursive: true
  });

  const tarball = path.join(temporaryRoot, "candidate.tgz");
  const candidate = await createFixtureTarball(tarball, commit);
  const scenarioId = scenarioForCurrentPlatform();
  const scenario = policy.pilot.required_scenarios.find((entry) => entry.id === scenarioId);
  assert.ok(scenario);
  const marker = canonicalPilotRecoveryMarker(scenario);
  await fs.writeFile(
    path.join(workspace, "scripts", "agent-pilot-plan.mjs"),
    [
      "import fs from 'node:fs/promises';",
      "import path from 'node:path';",
      "const argv = process.argv.slice(2);",
      "if (argv.length !== 8 || argv.some((value, index) => index % 2 === 0 && !['--exercise-scenario', '--phase', '--package-root', '--work-root'].includes(value))) throw new Error('fixture arguments invalid');",
      "const parsed = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [argv[index * 2], argv[index * 2 + 1]]));",
      `if (parsed['--exercise-scenario'] !== ${JSON.stringify(scenario.id)}) throw new Error('fixture scenario invalid');`,
      "if (parsed['--package-root'] !== 'output/pilots/package') throw new Error('fixture package root invalid');",
      `if (parsed['--work-root'] !== ${JSON.stringify(`output/pilots/work/${scenario.id}`)}) throw new Error('fixture work root invalid');`,
      "const workRoot = path.resolve(process.cwd(), ...parsed['--work-root'].split('/'));",
      "const sentinel = path.join(workRoot, '.pilot-owned');",
      "if (parsed['--phase'] === 'prepare') {",
      "  await fs.mkdir(workRoot, { recursive: true });",
      `  await fs.writeFile(sentinel, ${JSON.stringify(`${scenario.id}\n`)}, { encoding: 'utf8', flag: 'wx' });`,
      "  process.stdout.write('prepared=true\\n');",
      "} else {",
      `  if (await fs.readFile(sentinel, 'utf8') !== ${JSON.stringify(`${scenario.id}\n`)}) throw new Error('fixture sentinel invalid');`,
      "  if (parsed['--phase'] === 'controlled-failure') {",
      "    process.stderr.write('fixture controlled failure\\n');",
      "    process.exitCode = 47;",
      "  } else if (parsed['--phase'] === 'recovery') {",
      `    await fs.writeFile(path.join(workRoot, 'recovered.txt'), ${JSON.stringify(marker)}, { encoding: 'utf8', flag: 'wx' });`,
      "    process.stdout.write('fixture recovery output\\n');",
      "  } else {",
      "    throw new Error('fixture phase invalid');",
      "  }",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  const plan = buildCanonicalAgentPilotPlan(policy, scenarioId, candidate);
  const planPath = path.join(temporaryRoot, "plan.json");
  await writeJson(planPath, plan);
  const actionsContext = ["linux", "macos"].includes(scenario.context);
  const syntheticRunId = "123456789";
  const provenanceEnvelopePath = path.join(temporaryRoot, "provenance-envelope.json");
  if (actionsContext) {
    await writeJson(provenanceEnvelopePath, {
      schema_version: 1,
      repository: policy.monitoring_evidence.canonical_repository,
      workflow_path: ".github/workflows/studio-npm-package-assurance.yml",
      run_id: syntheticRunId,
      run_attempt: 1,
      job_name: `agent-pilot-${scenarioId}`,
      event_name: "workflow_dispatch",
      ref: "refs/heads/main",
      sha: commit,
      artifact_name: `studio-agent-pilot-${scenarioId}-${syntheticRunId}.json`
    });
  }
  const provenanceOptions = actionsContext
    ? { provenanceEnvelopePath }
    : {};

  const result = await collectAgentPilot({
    policyPath,
    planPath,
    tarballPath: tarball,
    workspaceRoot: workspace,
    collectorRepositoryRoot: collectorRepository,
    collectorFile: collectorScript,
    ...provenanceOptions
  });
  assert.equal(verifyAgentPilotResult(result), true);
  assert.equal(result.receipt.evidence_class, "operator-attested-machine-collected");
  assert.equal(result.receipt.independent_execution, false);
  assert.equal(result.receipt.redacted, true);
  assert.equal(result.phase5_embedding_summary.completed, true);
  assert.equal(result.phase5_embedding_summary.controlled_failure, true);
  assert.equal(result.phase5_embedding_summary.recovery_attempted, true);
  assert.equal(result.phase5_embedding_summary.recovered, true);
  assert.equal(
    result.phase5_embedding_summary.run_url,
    actionsContext
      ? `https://github.com/${policy.monitoring_evidence.canonical_repository}/actions/runs/${syntheticRunId}`
      : null
  );
  assert.equal(
    result.phase5_embedding_summary.artifact_name,
    actionsContext
      ? `studio-agent-pilot-${scenarioId}-${syntheticRunId}.json`
      : null
  );
  assert.equal(result.phase5_embedding_summary.provenance, null);
  assert.equal(result.receipt.candidate.package_commit, commit);
  assert.equal(result.receipt.candidate.tarball_sha256, candidate.tarball_sha256);
  assert.equal(
    result.receipt.candidate.package_inventory_sha256,
    candidate.package_inventory_sha256
  );
  assert.equal(result.receipt.candidate.package_file_count, 2);
  assert.equal(result.receipt.collector.commit, commit);
  assert.equal(result.receipt.collector.path, "scripts/agent-pilot-collector.mjs");
  assert.deepEqual(result.receipt.plan, plan);
  assert.equal(result.receipt.plan_sha256, canonicalSha256(plan));
  assert.ok(result.phase5_embedding_summary.duration_seconds >= 1);
  assert.equal(
    Date.parse(result.phase5_embedding_summary.completed_at)
      - Date.parse(result.phase5_embedding_summary.started_at),
    result.phase5_embedding_summary.duration_seconds * 1_000
  );
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(temporaryRoot));
  assert.ok(!serialized.includes("fixture controlled failure"));
  assert.ok(!serialized.includes("fixture recovery output"));
  assert.equal(
    result.receipt.execution.raw_observation_bundle_sha256,
    canonicalSha256(result.receipt.execution.observations)
  );
  const controlledObservation = result.receipt.execution.observations[1];
  assert.deepEqual(controlledObservation.args, plan.steps[1].args);
  assert.equal(controlledObservation.cwd, plan.steps[1].cwd);
  assert.equal(controlledObservation.exit_code, 47);
  assert.ok(controlledObservation.stderr_bytes > 0);
  assert.match(controlledObservation.stderr_sha256, /^[a-f0-9]{64}$/u);

  assert.equal(
    canonicalSha256({ z: 2, a: { y: true, x: [3, 1] } }),
    canonicalSha256({ a: { x: [3, 1], y: true }, z: 2 })
  );
  assert.equal(
    canonicalJson({ z: 2, a: 1 }),
    "{\"a\":1,\"z\":2}"
  );

  const wrongScenario = clone(plan);
  wrongScenario.scenario_id = "not-a-required-scenario";
  assert.throws(
    () => validatePilotPlan(policy, wrongScenario),
    /exact eight reviewed pilot scenarios/u
  );

  const wrongTarball = path.join(temporaryRoot, "wrong-candidate.tgz");
  const wrongTarballBytes = Buffer.from(await fs.readFile(tarball));
  wrongTarballBytes[Math.floor(wrongTarballBytes.length / 2)] ^= 0xff;
  await fs.writeFile(wrongTarball, wrongTarballBytes);
  await expectReject(
    () => collectAgentPilot({
      policyPath,
      planPath,
      tarballPath: wrongTarball,
      workspaceRoot: workspace,
      collectorRepositoryRoot: collectorRepository,
      collectorFile: collectorScript,
      ...provenanceOptions
    }),
    /tarball bytes do not match/u
  );

  const wrongManifestTarball = path.join(temporaryRoot, "wrong-manifest.tgz");
  const wrongManifestCandidate = await createFixtureTarball(
    wrongManifestTarball,
    commit,
    { manifest: { commit: "0".repeat(40) } }
  );
  wrongManifestCandidate.package_commit = commit;
  const wrongManifestPlan = clone(plan);
  wrongManifestPlan.candidate = wrongManifestCandidate;
  const wrongManifestPlanPath = path.join(temporaryRoot, "wrong-manifest-plan.json");
  await writeJson(wrongManifestPlanPath, wrongManifestPlan);
  await expectReject(
    () => collectAgentPilot({
      policyPath,
      planPath: wrongManifestPlanPath,
      tarballPath: wrongManifestTarball,
      workspaceRoot: workspace,
      collectorRepositoryRoot: collectorRepository,
      collectorFile: collectorScript,
      ...provenanceOptions
    }),
    /embedded npm package identity/u
  );

  const fakeEvalPlan = clone(plan);
  fakeEvalPlan.steps[0].args = ["-e", "process.exit(0)"];
  assert.throws(
    () => validatePilotPlan(policy, fakeEvalPlan),
    /canonical scenario plan/u
  );

  const fixtureStepPlan = clone(plan);
  fixtureStepPlan.steps[1].args = [
    "scripts/agent-pilot-plan.mjs",
    "--fixture-step",
    "controlled-failure"
  ];
  assert.throws(
    () => validatePilotPlan(policy, fixtureStepPlan),
    /canonical scenario plan/u
  );

  const alteredArgvPlan = clone(plan);
  alteredArgvPlan.steps[2].args[
    alteredArgvPlan.steps[2].args.indexOf("--phase") + 1
  ] = "controlled-failure";
  assert.throws(
    () => validatePilotPlan(policy, alteredArgvPlan),
    /canonical scenario plan/u
  );

  const alteredTimeoutPlan = clone(plan);
  alteredTimeoutPlan.steps[0].timeout_ms -= 1;
  assert.throws(
    () => validatePilotPlan(policy, alteredTimeoutPlan),
    /canonical scenario plan/u
  );

  const missingFailure = clone(plan);
  missingFailure.steps[1].role = "setup";
  assert.throws(
    () => validatePilotPlan(policy, missingFailure),
    /controlled failure, recovery, and final verification/u
  );
  const missingRecovery = clone(plan);
  missingRecovery.steps[2].role = "verification";
  assert.throws(
    () => validatePilotPlan(policy, missingRecovery),
    /controlled failure, recovery, and final verification/u
  );

  const secretPlan = clone(plan);
  secretPlan.steps[0].args.push(`--access-token=npm_${"a".repeat(24)}`);
  assert.throws(
    () => validatePilotPlan(policy, secretPlan),
    /secret-like value/u
  );

  const tampered = clone(result);
  tampered.receipt.execution.observations[1].exit_code = 0;
  assert.throws(
    () => verifyAgentPilotResult(tampered),
    /receipt digest/u
  );
  const observationTamper = clone(result);
  observationTamper.receipt.execution.observations[0].stderr_bytes += 1;
  observationTamper.receipt_sha256 = canonicalSha256(observationTamper.receipt);
  observationTamper.phase5_embedding_summary.receipt_sha256 = observationTamper.receipt_sha256;
  observationTamper.phase5_embedding_summary.receipt_json =
    canonicalJson(observationTamper.receipt);
  observationTamper.github_actions_provenance_output.collector_receipt_sha256 =
    observationTamper.receipt_sha256;
  assert.throws(
    () => verifyAgentPilotResult(observationTamper),
    /raw observation bundle digest/u
  );
  const failingSetup = clone(result);
  const setupObservation = failingSetup.receipt.execution.observations.find(
    (observation) => observation.role === "setup"
  );
  setupObservation.observed_outcome = "failure";
  setupObservation.exit_code = 1;
  failingSetup.receipt.execution.raw_observation_bundle_sha256 =
    canonicalSha256(failingSetup.receipt.execution.observations);
  rebindResultWrapper(failingSetup);
  assert.throws(
    () => verifyAgentPilotResult(failingSetup),
    /command observation .* is not bound/u
  );
  const planTamper = clone(result);
  planTamper.receipt.plan.steps[0].args = ["fixture/recover.mjs"];
  planTamper.receipt_sha256 = canonicalSha256(planTamper.receipt);
  planTamper.phase5_embedding_summary.receipt_sha256 = planTamper.receipt_sha256;
  planTamper.phase5_embedding_summary.receipt_json = canonicalJson(planTamper.receipt);
  planTamper.github_actions_provenance_output.collector_receipt_sha256 =
    planTamper.receipt_sha256;
  assert.throws(
    () => verifyAgentPilotResult(planTamper),
    /invalid shape or assurance label/u
  );
  const fullyRehashedPlanTamper = clone(result);
  const tamperedPlanStep = fullyRehashedPlanTamper.receipt.plan.steps.find(
    (step) => step.role === "setup"
  );
  const tamperedPlanObservation =
    fullyRehashedPlanTamper.receipt.execution.observations.find(
      (observation) => observation.id === tamperedPlanStep.id
    );
  tamperedPlanStep.args = ["-e", "process.exitCode = 0"];
  tamperedPlanObservation.args = [...tamperedPlanStep.args];
  fullyRehashedPlanTamper.receipt.plan_sha256 =
    canonicalSha256(fullyRehashedPlanTamper.receipt.plan);
  fullyRehashedPlanTamper.receipt.execution.raw_observation_bundle_sha256 =
    canonicalSha256(fullyRehashedPlanTamper.receipt.execution.observations);
  rebindResultWrapper(fullyRehashedPlanTamper);
  assert.throws(
    () => verifyAgentPilotResult(fullyRehashedPlanTamper),
    /canonical policy scenario and candidate/u
  );
  const fullyRehashedScenarioTamper = clone(result);
  fullyRehashedScenarioTamper.receipt.scenario.capability = "tampered-capability";
  rebindResultWrapper(fullyRehashedScenarioTamper);
  assert.throws(
    () => verifyAgentPilotResult(fullyRehashedScenarioTamper),
    /receipt scenario does not exact-match/u
  );

  process.stdout.write("Agent pilot collector tests passed.\n");
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
