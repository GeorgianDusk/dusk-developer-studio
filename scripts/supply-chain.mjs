import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "config", "supply-chain-policy.json");

export class SupplyChainError extends Error {}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupplyChainError(`Expected a JSON object: ${filePath}`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new SupplyChainError(`${label} must use the exact reviewed fields.`);
  }
}

export function validatePolicy(policy) {
  exactKeys(
    policy,
    [
      "schema_version",
      "assurance_node_version",
      "pnpm_version",
      "lockfile",
      "application_sbom",
      "container_bases",
      "runtime_package_upgrades",
      "npm_audit",
      "container_scan",
    ],
    "Supply-chain policy",
  );
  if (policy.schema_version !== 2 || !/^\d+\.\d+\.\d+$/.test(policy.assurance_node_version)) {
    throw new SupplyChainError("Supply-chain policy version or assurance Node pin is invalid.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(policy.pnpm_version)) {
    throw new SupplyChainError("Supply-chain policy pnpm pin is invalid.");
  }
  if (policy.lockfile !== "pnpm-lock.yaml") {
    throw new SupplyChainError("Supply-chain policy must bind the canonical pnpm lockfile.");
  }
  if (policy.application_sbom !== "provenance/studio-production-dependencies.cdx.json") {
    throw new SupplyChainError("Supply-chain policy has an unexpected application SBOM path.");
  }
  if (!Array.isArray(policy.container_bases) || policy.container_bases.length !== 2) {
    throw new SupplyChainError("Supply-chain policy must define exactly two container stages.");
  }
  const stages = [];
  for (const base of policy.container_bases) {
    exactKeys(base, ["stage", "image", "digest"], "Container base");
    if (!/^[a-z0-9./-]+:[A-Za-z0-9_.-]+$/.test(base.image)) {
      throw new SupplyChainError(`Container base tag is invalid: ${base.image}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(base.digest)) {
      throw new SupplyChainError(`Container base digest is invalid: ${base.image}`);
    }
    stages.push(base.stage);
  }
  if (JSON.stringify(stages) !== JSON.stringify(["build", "runtime"])) {
    throw new SupplyChainError("Container bases must define build then runtime stages.");
  }
  if (!Array.isArray(policy.runtime_package_upgrades) || policy.runtime_package_upgrades.length !== 2) {
    throw new SupplyChainError("Supply-chain policy must define exactly two runtime package upgrades.");
  }
  const runtimePackageNames = [];
  for (const packagePin of policy.runtime_package_upgrades) {
    exactKeys(packagePin, ["name", "version"], "Runtime package upgrade");
    if (!/^[a-z0-9][a-z0-9+.-]*$/.test(packagePin.name) || !/^[A-Za-z0-9.+:~_-]+$/.test(packagePin.version)) {
      throw new SupplyChainError("Runtime package upgrade pin is invalid.");
    }
    runtimePackageNames.push(packagePin.name);
  }
  if (JSON.stringify(runtimePackageNames) !== JSON.stringify(["libcrypto3", "libssl3"])) {
    throw new SupplyChainError("Runtime package upgrades must bind the reviewed OpenSSL package set.");
  }
  exactKeys(policy.npm_audit, ["production_only", "minimum_severity", "exceptions"], "npm audit policy");
  if (
    policy.npm_audit.production_only !== true ||
    policy.npm_audit.minimum_severity !== "moderate" ||
    !Array.isArray(policy.npm_audit.exceptions) ||
    policy.npm_audit.exceptions.length !== 0
  ) {
    throw new SupplyChainError("npm audit policy must fail at moderate severity with no exceptions.");
  }
  exactKeys(
    policy.container_scan,
    ["scanner", "action_commit", "action_version", "trivy_version", "blocking_severities", "ignore_unfixed", "exceptions"],
    "Container scan policy",
  );
  if (
    policy.container_scan.scanner !== "trivy-action" ||
    !/^[0-9a-f]{40}$/.test(policy.container_scan.action_commit) ||
    !/^v\d+\.\d+\.\d+$/.test(policy.container_scan.action_version) ||
    !/^v\d+\.\d+\.\d+$/.test(policy.container_scan.trivy_version) ||
    JSON.stringify(policy.container_scan.blocking_severities) !== JSON.stringify(["CRITICAL", "HIGH"]) ||
    policy.container_scan.ignore_unfixed !== false ||
    !Array.isArray(policy.container_scan.exceptions) ||
    policy.container_scan.exceptions.length !== 0
  ) {
    throw new SupplyChainError("Container scan policy is not the reviewed fail-closed contract.");
  }
  return policy;
}

export function expectedDockerFromLines(policy) {
  return [
    `FROM ${policy.container_bases[0].image}@${policy.container_bases[0].digest} AS build`,
    `FROM ${policy.container_bases[1].image}@${policy.container_bases[1].digest}`,
  ];
}

export function expectedRuntimeUpgradeLine(policy) {
  const pins = policy.runtime_package_upgrades.map(({ name, version }) => `${name}=${version}`).join(" ");
  return `RUN apk add --no-cache --upgrade ${pins}`;
}

export function validateDockerfile(dockerfile, policy) {
  const observed = dockerfile
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^FROM\s+/iu.test(line));
  const expected = expectedDockerFromLines(policy);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new SupplyChainError("Dockerfile base images do not match the reviewed digest pins.");
  }
  const runtimeUpgradeLines = dockerfile
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^RUN\s+apk\s+/iu.test(line));
  if (JSON.stringify(runtimeUpgradeLines) !== JSON.stringify([expectedRuntimeUpgradeLine(policy)])) {
    throw new SupplyChainError("Dockerfile runtime package upgrades do not match the reviewed version pins.");
  }
}

function packagePurl(name, version) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.slice(1).split("/");
    return `pkg:npm/%40${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

export function flattenProductionDependencies(workspaces) {
  if (!Array.isArray(workspaces)) {
    throw new SupplyChainError("pnpm production dependency inventory must be an array.");
  }
  const components = new Map();
  const visit = (dependencies) => {
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return;
    for (const [fallbackName, dependency] of Object.entries(dependencies)) {
      if (!dependency || typeof dependency !== "object" || Array.isArray(dependency)) continue;
      const name = typeof dependency.from === "string" && dependency.from ? dependency.from : fallbackName;
      const version = typeof dependency.version === "string" ? dependency.version : "";
      if (version && !version.startsWith("link:") && !version.startsWith("workspace:")) {
        const key = `${name}\u0000${version}`;
        components.set(key, { name, version });
      }
      visit(dependency.dependencies);
    }
  };
  for (const workspace of workspaces) visit(workspace?.dependencies);
  return [...components.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

export function buildSbom({ policy, lockBytes, dockerfileBytes, packageManifest, workspaces }) {
  const components = flattenProductionDependencies(workspaces).map(({ name, version }) => {
    const purl = packagePurl(name, version);
    return { type: "library", "bom-ref": purl, name, version, purl };
  });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": "urn:dusk:developer-studio",
        name: packageManifest.name,
        version: packageManifest.version,
      },
      properties: [
        { name: "dusk:pnpm-lock-sha256", value: sha256(lockBytes) },
        { name: "dusk:dockerfile-sha256", value: sha256(dockerfileBytes) },
        { name: "dusk:assurance-node-version", value: policy.assurance_node_version },
        { name: "dusk:pnpm-version", value: policy.pnpm_version },
        ...policy.container_bases.map((base) => ({
          name: `dusk:container-base:${base.stage}`,
          value: `${base.image}@${base.digest}`,
        })),
        ...policy.runtime_package_upgrades.map((packagePin) => ({
          name: "dusk:runtime-package-upgrade",
          value: `${packagePin.name}=${packagePin.version}`,
        })),
      ],
    },
    components,
  };
}

function runPnpm(args) {
  let executable = "pnpm";
  let spawnArgs = args;
  if (process.platform === "win32") {
    if (args.some((value) => !/^[A-Za-z0-9.,:=_-]+$/u.test(value))) {
      throw new SupplyChainError("Refusing an unsafe pnpm argument on Windows.");
    }
    executable = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    spawnArgs = ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`];
  }
  const result = spawnSync(executable, spawnArgs, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new SupplyChainError(`Could not run pnpm: ${result.error.message}`);
  return result;
}

function productionInventory() {
  const result = runPnpm(["list", "--json", "--prod", "--depth", "Infinity"]);
  if (result.status !== 0) {
    throw new SupplyChainError(`pnpm production inventory failed: ${(result.stderr || result.stdout).trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new SupplyChainError(`pnpm production inventory was not valid JSON: ${error.message}`);
  }
}

function repositoryInputs() {
  const policy = validatePolicy(readJson(POLICY_PATH));
  const packageManifest = readJson(path.join(ROOT, "package.json"));
  if (packageManifest.packageManager !== `pnpm@${policy.pnpm_version}`) {
    throw new SupplyChainError("package.json packageManager does not match the reviewed pnpm pin.");
  }
  const dockerfileBytes = fs.readFileSync(path.join(ROOT, "Dockerfile"));
  validateDockerfile(dockerfileBytes.toString("utf8"), policy);
  const lockBytes = fs.readFileSync(path.join(ROOT, policy.lockfile));
  return { policy, packageManifest, dockerfileBytes, lockBytes };
}

function generatedSbom() {
  return buildSbom({ ...repositoryInputs(), workspaces: productionInventory() });
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, value, { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

export function summarizePnpmAudit(payload, policy, processStatus) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SupplyChainError("pnpm audit response must be a JSON object.");
  }
  const counts = payload.metadata?.vulnerabilities;
  if (!counts || typeof counts !== "object") {
    throw new SupplyChainError("pnpm audit response is missing vulnerability counts.");
  }
  const normalizedCounts = {};
  for (const severity of ["info", "low", "moderate", "high", "critical", "total"]) {
    const value = counts[severity] ?? 0;
    if (!Number.isInteger(value) || value < 0) {
      throw new SupplyChainError(`pnpm audit returned an invalid ${severity} count.`);
    }
    normalizedCounts[severity] = value;
  }
  const blockingCount = normalizedCounts.moderate + normalizedCounts.high + normalizedCounts.critical;
  const findings = [];
  const vulnerabilities = payload.vulnerabilities ?? {};
  if (!vulnerabilities || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    throw new SupplyChainError("pnpm audit vulnerabilities must be an object.");
  }
  for (const [name, value] of Object.entries(vulnerabilities)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    findings.push({
      package: name,
      severity: String(value.severity ?? "unknown"),
      range: String(value.range ?? ""),
      fix_available: Boolean(value.fixAvailable),
    });
  }
  findings.sort((left, right) => left.package.localeCompare(right.package));
  if (blockingCount === 0 && processStatus !== 0) {
    throw new SupplyChainError(`pnpm audit exited ${processStatus} without a blocking finding.`);
  }
  return {
    schema_version: 1,
    status: blockingCount === 0 ? "passed" : "failed_unresolved_vulnerabilities",
    production_only: policy.npm_audit.production_only,
    minimum_severity: policy.npm_audit.minimum_severity,
    counts: normalizedCounts,
    blocking_count: blockingCount,
    findings,
    scanned_at_utc: new Date().toISOString(),
  };
}

function commandSbom() {
  const { policy } = repositoryInputs();
  const output = path.join(ROOT, policy.application_sbom);
  const sbom = generatedSbom();
  atomicWrite(output, canonicalJson(sbom));
  console.log(JSON.stringify({ status: "passed", components: sbom.components.length, output: policy.application_sbom }, null, 2));
}

function commandCheck() {
  const { policy } = repositoryInputs();
  const expected = generatedSbom();
  const observed = readJson(path.join(ROOT, policy.application_sbom));
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new SupplyChainError("The committed Studio application SBOM is stale or malformed.");
  }
  console.log(JSON.stringify({ status: "passed", components: expected.components.length }, null, 2));
}

function commandAudit(args) {
  const outputIndex = args.indexOf("--output");
  if (outputIndex === -1 || !args[outputIndex + 1]) {
    throw new SupplyChainError("audit requires --output <receipt.json>.");
  }
  const { policy } = repositoryInputs();
  const result = runPnpm(["audit", "--prod", "--audit-level=moderate", "--json"]);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw new SupplyChainError(`pnpm audit did not return valid JSON: ${error.message}; ${result.stderr.trim()}`);
  }
  const receipt = summarizePnpmAudit(payload, policy, result.status);
  const output = path.resolve(ROOT, args[outputIndex + 1]);
  atomicWrite(output, canonicalJson(receipt));
  console.log(JSON.stringify({ status: receipt.status, blocking_count: receipt.blocking_count, output: path.relative(ROOT, output) }, null, 2));
  if (receipt.blocking_count !== 0) process.exitCode = 2;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "sbom") commandSbom();
  else if (command === "check") commandCheck();
  else if (command === "audit") commandAudit(args);
  else throw new SupplyChainError("Usage: supply-chain.mjs <sbom|check|audit --output FILE>.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`Studio supply-chain check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
