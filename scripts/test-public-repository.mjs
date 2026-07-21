import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validatePreflightConsumerContract } from "./npm-package-preflight-smoke.mjs";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const listTextFiles = (directory) => fs.readdirSync(path.join(root, directory), {
  recursive: true,
  withFileTypes: true
})
  .filter((entry) => entry.isFile() && /\.(?:md|mjs|ts|tsx|ya?ml)$/u.test(entry.name))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));

for (const file of [
  "LICENSE", "NOTICE", "SECURITY.md", "CONTRIBUTING.md",
  ".github/CODEOWNERS", ".github/dependabot.yml",
  ".github/workflows/studio-linux-security.yml",
  ".github/workflows/platform-caddy-security.yml",
  ".github/workflows/studio-npm-package-assurance.yml",
  ".github/workflows/studio-npm-publish.yml",
  ".github/workflows/studio-npm-oidc-publish.yml",
  ".github/workflows/studio-public-staging.yml",
  ".github/workflows/studio-monitor-schedule-guard.yml",
  ".github/workflows/duskds-native-smoke.yml",
  "docs/evidence/npm-initial-publication-receipt-29686128164.json",
  "docs/security/duskds-cargo-advisory-review.md",
  "docs/operations/public-monitoring.md",
  "scripts/check-cargo-advisory-review.mjs",
  "scripts/npm-package-browser-response.mjs",
  "scripts/test-npm-package-browser-response.mjs",
  "scripts/npm-package-preflight-smoke.mjs",
  "scripts/prepublication-candidate-binding.mjs",
  "scripts/test-prepublication-candidate-binding.mjs",
  "scripts/resolve-main-assurance-artifact.mjs",
  "scripts/test-resolve-main-assurance-artifact.mjs",
  "scripts/phase5-candidate-context.mjs",
  "scripts/verify-npm-provenance.mjs",
  "config/cargo-advisory-review.json",
  "config/companion-release-policy.json",
  "SUPPORT.md"
]) assert.ok(fs.existsSync(path.join(root, file)), `Missing public repository contract: ${file}`);

const initialPublicationEvidence = {
  candidate_commit: "5447a6eb008157e1e9bd6b38de1a3789d17a67b7",
  integrity: "sha512-8wimo6v5iexej2r8r3r+k/eFf/or1WbPkblM5sLmg+QANzpJs328NZqH/Elzc0Y3dF37a6Elsadm9I9PiQpF3A==",
  package_inventory_sha256: "01addb99e9a1a7484b180ea42da2ded9decb64113e709f5848daa93087d34ff3",
  run_id: 29686128164,
  artifact_id: 8442414228,
  artifact_name: "studio-npm-publication-receipt-29686128164.json",
  artifact_expires_at: "2026-10-17T11:58:51Z",
  preserved_receipt_path: "docs/evidence/npm-initial-publication-receipt-29686128164.json",
  receipt_sha256: "72c60fabe5378c8ef5fa81434e01953cbaf5739fdd1fe3364862d0ddfec041e5",
  observed_at: "2026-07-19T12:30:25.617Z"
};
const preservedInitialPublicationReceiptBytes = fs.readFileSync(
  path.join(root, initialPublicationEvidence.preserved_receipt_path)
);
assert.equal(
  createHash("sha256").update(preservedInitialPublicationReceiptBytes).digest("hex"),
  initialPublicationEvidence.receipt_sha256
);
const preservedInitialPublicationReceipt = JSON.parse(
  preservedInitialPublicationReceiptBytes.toString("utf8")
);
assert.equal(preservedInitialPublicationReceipt.status, "published");
assert.equal(
  preservedInitialPublicationReceipt.candidate_commit,
  initialPublicationEvidence.candidate_commit
);
assert.equal(preservedInitialPublicationReceipt.integrity, initialPublicationEvidence.integrity);
assert.equal(
  preservedInitialPublicationReceipt.package_inventory_sha256,
  initialPublicationEvidence.package_inventory_sha256
);
assert.equal(preservedInitialPublicationReceipt.observed_at, initialPublicationEvidence.observed_at);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.private, true, "The workspace must remain protected from accidental npm publication.");
assert.equal(packageJson.license, "Apache-2.0");
assert.equal(packageJson.repository.url, "git+https://github.com/GeorgianDusk/dusk-developer-studio.git");
const dependabotConfig = read(".github/dependabot.yml");
assert.match(
  dependabotConfig,
  /package-ecosystem: cargo[\s\S]*directory: \/packages\/templates\/duskds-counter-forge[\s\S]*versioning-strategy: lockfile-only/u,
  "The embedded DuskDS Cargo lock must remain under recurring dependency monitoring."
);
assert.match(read("LICENSE"), /Apache License[\s\S]*Version 2\.0/);
assert.doesNotMatch(read("README.md"), /private: true|Project status/);
assert.match(read("SECURITY.md"), /private vulnerability reporting/i);
assert.doesNotMatch(read("README.md"), /`[^`]+` \? /, "README repository map contains a lossy text-export separator.");

const duskDsTemplateRoot = "packages/templates/duskds-counter-forge";
const duskDsPackagedTemplateRoot = "templates/duskds-counter-forge";
const duskDsTemplateFiles = [
  ".gitignore.template",
  "Cargo.lock",
  "Cargo.toml",
  "LICENSE-MPL-2.0.txt",
  "Makefile",
  "PROVENANCE.md",
  "README.md",
  "rust-toolchain.toml",
  "src/lib.rs",
  "tests/contract.rs"
];
for (const file of duskDsTemplateFiles) {
  assert.ok(
    fs.existsSync(path.join(root, duskDsTemplateRoot, file)),
    `Reviewed DuskDS template is missing ${file}.`
  );
}
assert.equal(
  fs.existsSync(path.join(root, duskDsTemplateRoot, ".gitignore")),
  false,
  "The npm template source must preserve .gitignore as .gitignore.template."
);
const duskDsTemplateLock = fs.readFileSync(
  path.join(root, duskDsTemplateRoot, "Cargo.lock")
);
assert.equal(
  createHash("sha256").update(duskDsTemplateLock).digest("hex"),
  "1408051342213d41a91342497b18856c87afc3bc0eeb1c750932e634525445da"
);
const duskDsTemplateLockText = duskDsTemplateLock.toString("utf8");
assert.match(
  duskDsTemplateLockText,
  /\[\[package\]\]\nname = "dusk-studio-template-project"\nversion = "0\.1\.0"/u
);
assert.match(
  duskDsTemplateLockText,
  /git\+https:\/\/github\.com\/dusk-network\/rusk\?tag=dusk-core-1\.6\.0#ae1a38a2079c681126a96f94c17d282ea2639946/u
);
assert.match(
  duskDsTemplateLockText,
  /\[\[package\]\]\nname = "serde_with"\nversion = "3\.21\.0"/u
);
assert.match(
  duskDsTemplateLockText,
  /\[\[package\]\]\nname = "time"\nversion = "0\.3\.53"/u
);
assert.doesNotMatch(duskDsTemplateLockText, /name = "serde_with"\nversion = "3\.17\.0"/u);
assert.doesNotMatch(duskDsTemplateLockText, /name = "time"\nversion = "0\.3\.45"/u);
const duskDsTemplateProvenance = read(`${duskDsTemplateRoot}/PROVENANCE.md`);
assert.match(duskDsTemplateProvenance, /reviewed security\s+refresh/u);
assert.match(duskDsTemplateProvenance, /GHSA-7gcf-g7xr-8hxj/u);
assert.match(duskDsTemplateProvenance, /GHSA-r6v5-fh4h-64xc/u);
assert.match(
  duskDsTemplateProvenance,
  /cargo \+1\.94\.0 update -p serde_with@3\.17\.0 --precise 3\.21\.0/u
);
assert.match(
  duskDsTemplateProvenance,
  /1408051342213d41a91342497b18856c87afc3bc0eeb1c750932e634525445da/u
);
const duskDsTemplateCargo = read(`${duskDsTemplateRoot}/Cargo.toml`);
assert.match(duskDsTemplateCargo, /^\[package\][\s\S]*^name = "dusk-studio-template-project"$/mu);
assert.match(duskDsTemplateCargo, /^rust-version = "1\.94"$/mu);
assert.match(duskDsTemplateCargo, /^license = "MPL-2\.0"$/mu);
assert.match(duskDsTemplateCargo, /^publish = false$/mu);
assert.match(
  read(`${duskDsTemplateRoot}/rust-toolchain.toml`),
  /^\[toolchain\]\nchannel = "1\.94\.0"$/mu
);
assert.match(duskDsTemplateProvenance, /d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a/u);
assert.match(duskDsTemplateProvenance, /6657e6da48dc245860aa8575b0633d88e0cdd7fcedce524789c682d246284ea4/u);
assert.equal(
  createHash("sha256")
    .update(fs.readFileSync(path.join(root, duskDsTemplateRoot, "LICENSE-MPL-2.0.txt")))
    .digest("hex"),
  "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5"
);
assert.ok(fs.existsSync(path.join(root, "packages/templates/src/duskDsCounterForge.ts")));
assert.ok(fs.existsSync(path.join(root, "packages/templates/src/duskDsCounterForge.test.ts")));
for (const file of [
  ".github/workflows/duskds-native-smoke.yml",
  "README.md",
  "packages/cli/README.md",
  ...listTextFiles("docs"),
  ...listTextFiles("packages/cli/bin"),
  ...listTextFiles("packages/local-agent/src").filter((file) => !file.includes("/__tests__/")),
  ...listTextFiles("packages/local-runtime/src").filter((file) => !file.includes("/__tests__/"))
]) {
  assert.doesNotMatch(
    read(file),
    /\bdusk-forge(?:\.exe)?\s+new\b/u,
    `Production and manual surfaces must not scaffold through Forge: ${file}`
  );
}

const policy = JSON.parse(read("config/companion-release-policy.json"));
assert.equal(policy.schema_version, 2);
assert.equal(policy.distribution, "npm");
assert.deepEqual(policy.package, {
  name: "dusk-developer-studio",
  version: "1.0.5",
  tag: "v1.0.5",
  registry: "https://registry.npmjs.org",
  access: "public",
  node_engine: ">=24.18.0 <25",
  package_root: "packages/cli",
  tarball_path: "output/npm/dusk-developer-studio-1.0.5.tgz",
  primary_entrypoint: "bin/dusk-developer-studio.mjs",
  safe_smoke_arguments: ["--lifecycle-self-test", "--no-open"],
  local_actions_capability_contract_smoke_arguments: ["local-actions", "--lifecycle-self-test", "--no-open"]
});
assert.deepEqual(policy.commands, {
  build: "pnpm build:npm",
  test: "pnpm test:npm",
  pack: "pnpm pack:npm"
});
assert.equal(policy.package_inventory.native_binaries_allowed, false);
assert.equal(policy.package_inventory.install_scripts_allowed, false);
assert.equal(policy.package_inventory.runtime_dependencies_allowed, false);
for (const file of duskDsTemplateFiles) {
  assert.ok(
    policy.package_inventory.required_paths.includes(`${duskDsPackagedTemplateRoot}/${file}`),
    `Release policy is missing the packaged DuskDS template path ${file}.`
  );
}
assert.deepEqual(policy.assurance.required_runners, ["ubuntu-24.04", "windows-2025", "macos-15"]);
assert.ok(policy.assurance.required_checks.includes("local-actions-capability-contract-smoke"));
assert.ok(
  policy.assurance.required_checks.includes(
    "three-platform-exact-tarball-local-actions-preflight-producer-consumer-contract"
  )
);
assert.ok(
  policy.assurance.required_checks.includes(
    "three-platform-exact-tarball-direct-cli-scaffold-and-overwrite-refusal-smoke"
  )
);
assert.ok(
  policy.assurance.required_checks.includes(
    "three-platform-exact-tarball-local-actions-scaffold-preservation-shutdown-smoke"
  )
);
assert.ok(!policy.assurance.required_checks.includes("local-actions-functional-smoke"));
assert.equal(policy.publication.initial_registry_authentication, "short-lived-granular-token");
assert.equal(policy.publication.workflow_path, ".github/workflows/studio-npm-oidc-publish.yml");
assert.equal(policy.publication.environment, "npm-trusted-publication");
assert.equal(policy.publication.initial_package_version, "1.0.0");
assert.equal(policy.publication.initial_tag, "v1.0.0");
assert.deepEqual(policy.publication.initial_publication_evidence, initialPublicationEvidence);
assert.equal(policy.publication.initial_token_max_lifetime_hours, 24);
assert.deepEqual(policy.publication.initial_token_scope, {
  permissions: "read-write",
  package_access: "all-packages-bootstrap",
  bypass_2fa: true
});
assert.equal(policy.publication.token_revocation_required, true);
assert.equal(policy.publication.environment_secret_removal_required, true);
assert.equal(policy.publication.trusted_publisher_configuration_required, true);
assert.equal(policy.publication.subsequent_registry_authentication, "github-oidc");
assert.equal(policy.publication.subsequent_workflow_path, ".github/workflows/studio-npm-oidc-publish.yml");
assert.equal(policy.publication.expected_oidc_trusted_publisher_id, "github");
assert.equal(policy.publication.long_lived_token_allowed, false);
assert.deepEqual(policy.publication.permissions, { contents: "read", "id-token": "write" });
for (const removed of [
  ".github/workflows/studio-companion-signed-rc.yml",
  ".github/workflows/studio-companion-unsigned-assurance.yml",
  "config/companion-standalone-signing-policy.json",
  "config/companion-unsigned-assurance-policy.json"
]) assert.equal(fs.existsSync(path.join(root, removed)), false, `Retired native distribution contract still exists: ${removed}`);
const workflows = [
  ".github/workflows/studio-linux-security.yml",
  ".github/workflows/platform-caddy-security.yml",
  ".github/workflows/studio-npm-package-assurance.yml",
  ".github/workflows/studio-npm-publish.yml",
  ".github/workflows/studio-npm-oidc-publish.yml",
  ".github/workflows/studio-public-staging.yml",
  ".github/workflows/studio-monitor-schedule-guard.yml",
  ".github/workflows/duskds-native-smoke.yml"
].map((file) => [file, read(file)]);
for (const [file, workflow] of workflows) {
  assert.doesNotMatch(workflow, /dusk-network\/marketing|products\/developer-testnet-studio/);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|actions:\s*write/);
  assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?![a-f0-9]{40}(?:\s|$))/m, `${file} contains a mutable action reference.`);
  if (workflow.includes("actions/setup-node@")) {
    const nodeVersions = [...workflow.matchAll(/node-version:\s*([^\s]+)/g)].map((match) => match[1]);
    assert.ok(nodeVersions.length > 0, `${file} uses setup-node without a frozen Node version.`);
    assert.ok(nodeVersions.every((version) => version === "24.18.0"), `${file} does not use the frozen npm package runtime version.`);
  }
  const nodeHeredocOpeners = (workflow.match(/<<'NODE'/g) ?? []).length;
  if (nodeHeredocOpeners > 0) {
    assert.equal(
      (workflow.match(/^ {10}NODE$/gm) ?? []).length,
      nodeHeredocOpeners,
      `${file} contains a shell heredoc terminator outside the workflow run-block content column.`
    );
  }
}

const requiredWindowsWorkflow = read(".github/workflows/studio-linux-security.yml");
assert.match(requiredWindowsWorkflow, /schedule:[\s\S]*cron: "23 4 \* \* 1"/u);
assert.match(
  requiredWindowsWorkflow,
  /rustup toolchain install 1\.94\.0 --profile minimal[\s\S]*cargo \+1\.94\.0 install --locked[\s\S]*--root "\$RUNNER_TEMP\/cargo-audit-0\.22\.2"[\s\S]*--version 0\.22\.2[\s\S]*cargo-audit/u
);
assert.match(
  requiredWindowsWorkflow,
  /CARGO_AUDIT_BIN: \$\{\{ runner\.temp \}\}\/cargo-audit-0\.22\.2\/bin\/cargo-audit[\s\S]*node scripts\/check-cargo-advisory-review\.mjs/u
);
const cargoAdvisoryGate = read("scripts/check-cargo-advisory-review.mjs");
assert.match(cargoAdvisoryGate, /"audit"[\s\S]*"--json"[\s\S]*"--color"[\s\S]*"never"/u);
assert.match(cargoAdvisoryGate, /validateCargoAdvisoryReview/u);
assert.doesNotMatch(cargoAdvisoryGate, /"--ignore"|--deny warnings/u);
const cargoAdvisoryPolicy = JSON.parse(read("config/cargo-advisory-review.json"));
assert.equal(cargoAdvisoryPolicy.scanner.version, "0.22.2");
assert.deepEqual(
  cargoAdvisoryPolicy.accepted_informational_warnings.map(({ advisory_id: advisoryId }) => advisoryId),
  [
    "RUSTSEC-2025-0056",
    "RUSTSEC-2025-0141",
    "RUSTSEC-2024-0388",
    "RUSTSEC-2024-0436",
    "RUSTSEC-2026-0186"
  ]
);
const elevatedArchiveStepStart = requiredWindowsWorkflow.indexOf(
  "- name: Build, pack, install, and smoke the Windows npm package"
);
const elevatedArchiveStepEnd = requiredWindowsWorkflow.indexOf(
  "- name: Validate Windows, WSL, and POSIX command generation",
  elevatedArchiveStepStart
);
assert.ok(
  elevatedArchiveStepStart >= 0 && elevatedArchiveStepEnd > elevatedArchiveStepStart,
  "The required Windows npm elevation contract is missing."
);
const elevatedArchiveStep = requiredWindowsWorkflow.slice(elevatedArchiveStepStart, elevatedArchiveStepEnd);
assert.match(elevatedArchiveStep, /Dusk Developer Studio refuses elevated or root execution\./);
assert.match(elevatedArchiveStep, /pnpm build:npm[\s\S]*pnpm test:npm[\s\S]*pnpm pack:npm/);
assert.match(elevatedArchiveStep, /pack-receipt\.json[\s\S]*Join-Path 'output\/npm' \(\[string\] \$packReceipt\.filename\)/);
assert.match(elevatedArchiveStep, /node_modules\/dusk-developer-studio\/bin\/dusk-developer-studio\.mjs/);
assert.match(elevatedArchiveStep, /@(?:\(|\{)'--lifecycle-self-test', '--no-open'(?:\)|\})/);
assert.match(elevatedArchiveStep, /@(?:\(|\{)'local-actions', '--lifecycle-self-test', '--no-open'(?:\)|\})/);

const npmAssuranceWorkflow = read(".github/workflows/studio-npm-package-assurance.yml");
const npmPreflightSmoke = read("scripts/npm-package-preflight-smoke.mjs");
const npmBrowserSmoke = read("scripts/npm-package-browser-smoke.mjs");
const preflightConsumerSource = path.join(root, "apps/studio/src/app/responseSchemas.ts");
const compatibleIncompletePreflight = await validatePreflightConsumerContract({
  ok: false,
  checkedAt: "2026-07-21T00:00:00.000Z",
  path: "duskds",
  tools: [
    { name: "Node.js", command: "node", ok: true, required: true, version: "v24.18.0" },
    { name: "Optional missing tool", command: "optional-tool", ok: false, required: false, failureKind: "missing" }
  ]
}, preflightConsumerSource);
assert.equal(compatibleIncompletePreflight.tool_count, 2);
assert.equal(compatibleIncompletePreflight.versioned_tool_count, 1);
assert.equal(compatibleIncompletePreflight.aggregate_prerequisites_satisfied, false);
await assert.rejects(
  () => validatePreflightConsumerContract({
    ok: false,
    checkedAt: "2026-07-21T00:00:00.000Z",
    path: "duskds",
    tools: []
  }, preflightConsumerSource),
  /one to 64 bounded tool rows/
);
await assert.rejects(
  () => validatePreflightConsumerContract({
    ok: true,
    checkedAt: "2026-07-21T00:00:00.000Z",
    path: "duskds",
    tools: [{ name: "Node.js", command: "node", ok: true, required: true, version: "v".repeat(129) }]
  }, preflightConsumerSource),
  /exact checked-out Studio consumer guard rejected/
);
const localRuntime = read("packages/local-runtime/src/main.ts");
assert.match(localRuntime, /path: "\/scaffold-duskds-forge"[\s\S]*template !== "duskds-counter-forge"/);
assert.match(localRuntime, /schema_version: 2[\s\S]*local_actions_scaffold_smoke/);
assert.match(localRuntime, /exactRegularFileInventory[\s\S]*scaffold_preservation_smoke/);
assert.match(localRuntime, /shutdown_smoke: "passed"/);
assert.match(npmAssuranceWorkflow, /runner: \[ubuntu-24\.04, windows-2025, macos-15\]/);
assert.match(npmAssuranceWorkflow, /pnpm build:npm[\s\S]*pnpm test:npm[\s\S]*node scripts\/npm-package-pack\.mjs/);
assert.match(npmBrowserSmoke, /await context\.close\(\);[\s\S]*context = undefined;[\s\S]*validateBrowserTransportEvidence/);
assert.doesNotMatch(npmAssuranceWorkflow, /^\s+paths:/m);
assert.doesNotMatch(npmAssuranceWorkflow, /dusk-developer-studio-\d+\.\d+\.\d+\.tgz/);
assert.doesNotMatch(requiredWindowsWorkflow, /dusk-developer-studio-\d+\.\d+\.\d+\.tgz/);
assert.match(npmAssuranceWorkflow, /name: Bind the exact generated candidate artifact[\s\S]*pack-receipt\.json[\s\S]*receipt\.filename !== expectedArtifact[\s\S]*TARBALL=\$\{tarball\}[\s\S]*CANDIDATE_ARTIFACT=\$\{expectedArtifact\}/);
assert.match(npmAssuranceWorkflow, /CANDIDATE_ARTIFACT: \$\{\{ needs\.build-package\.outputs\.candidate_artifact_name \}\}[\s\S]*TARBALL: output\/npm\/\$\{\{ needs\.build-package\.outputs\.candidate_artifact_name \}\}/);
assert.match(npmAssuranceWorkflow, /name: Build the exact npm candidate once[\s\S]*name: \$\{\{ env\.CANDIDATE_ARTIFACT \}\}[\s\S]*archive: false/);
assert.match(npmAssuranceWorkflow, /needs: build-package[\s\S]*name: \$\{\{ env\.CANDIDATE_ARTIFACT \}\}[\s\S]*path: output\/npm/);
assert.match(npmAssuranceWorkflow, /^ {4}name: Aggregate npm package assurance$/m);
assert.match(npmAssuranceWorkflow, /native|exe\|dll\|dylib\|so\|node/i);
assert.match(npmAssuranceWorkflow, /npm install --ignore-scripts/);
assert.match(
  npmPreflightSmoke,
  /PREFLIGHT_CHECK_ID =\s*[\s\S]*three-platform-exact-tarball-local-actions-preflight-producer-consumer-contract/
);
assert.match(npmPreflightSmoke, /value\.tools\.length > 0 && value\.tools\.length <= MAX_TOOL_ROWS/);
assert.match(npmPreflightSmoke, /isNonemptyBoundedString\(tool\.version, MAX_VERSION_LENGTH\)/);
assert.match(npmPreflightSmoke, /versionedToolCount > 0/);
assert.match(npmPreflightSmoke, /aggregate_prerequisites_satisfied: value\.ok/);
assert.doesNotMatch(npmPreflightSmoke, /assert\.equal\(value\.ok, true/);
assert.match(npmPreflightSmoke, /stripTypeScriptTypes/);
assert.match(npmPreflightSmoke, /loadAuthoritativeConsumerGuard\(consumerSource\)/);
assert.match(npmPreflightSmoke, /consumer\.guard\(value\)[\s\S]*exact checked-out Studio consumer guard rejected/);
assert.match(npmPreflightSmoke, /consumer_contract_source_sha256/);
assert.match(npmPreflightSmoke, /RUNTIME_ENVIRONMENT_ALLOWLIST[\s\S]*inheritedRuntimeEnvironment\(process\.env\)/);
assert.doesNotMatch(npmPreflightSmoke, /\.\.\.process\.env/);
assert.match(npmPreflightSmoke, /\/__dusk\/bootstrap[\s\S]*\/preflight\?path=duskds/);
assert.match(npmPreflightSmoke, /spawn\(process\.execPath, \[primaryEntry, "local-actions", "--no-open"\]/);
assert.match(npmPreflightSmoke, /waitForPortsClosed\(\)/);
assert.match(npmPreflightSmoke, /studio_loopback_services_stopped: true/);
const npmBrowserResponse = read("scripts/npm-package-browser-response.mjs");
const npmBrowserTelemetry = read("scripts/npm-package-browser-telemetry.mjs");
assert.match(
  npmBrowserResponse,
  /Network\[\.\]getResponseBody\.\*No data found for resource with given identifier[\s\S]*context\.request\.get\(expectedUrl/,
  "The package browser smoke must recover only the known Chrome response-body eviction race."
);
assert.match(
  npmBrowserResponse,
  /expectedUrl[\s\S]*EXPECTED_PREFLIGHT_URL[\s\S]*expectedOrigin[\s\S]*EXPECTED_STUDIO_ORIGIN[\s\S]*headers: \{ origin: expectedOrigin \}[\s\S]*stableResponse\.status\(\)[\s\S]*200[\s\S]*return stableResponse\.json\(\)/,
  "The response-body fallback must bind the exact endpoint and origin, reuse the session, and require HTTP 200."
);
assert.doesNotMatch(
  npmBrowserSmoke,
  /validatePreflightConsumerContract\(\s*await preflightResponse\.json\(\)/,
  "The authoritative browser smoke must not depend exclusively on an evictable CDP response body."
);
assert.match(
  npmBrowserTelemetry,
  /EXPECTED_PREFLIGHT_URL[\s\S]*EXPECTED_STUDIO_ORIGIN[\s\S]*preflightEvent\.response[\s\S]*preflightResponse[\s\S]*preflightEvent\.request[\s\S]*preflightResponse\.request\(\)/,
  "Preflight abort classification must bind the exact page Request and Response objects."
);
assert.match(
  npmBrowserTelemetry,
  /redirectedFrom\(\)[\s\S]*null[\s\S]*preflightRequestHeaders[\s\S]*origin[\s\S]*EXPECTED_STUDIO_ORIGIN[\s\S]*preflightResponseHeaders[\s\S]*access-control-allow-origin[\s\S]*access-control-allow-credentials/,
  "Preflight abort classification must preserve the exact origin, no-redirect, and credentialed CORS boundary."
);
assert.match(
  npmBrowserSmoke,
  /preflightResponse\.request\(\)\.allHeaders\(\)[\s\S]*preflightResponse\.allHeaders\(\)/,
  "The browser smoke must capture complete headers from the exact preflight Request and Response."
);
assert.match(
  npmBrowserTelemetry,
  /preflightContractValidated[\s\S]*true[\s\S]*preflightUiRendered[\s\S]*true[\s\S]*validateTerminalState[\s\S]*toleratedFailures[\s\S]*unexpected request failure/,
  "Preflight abort classification must require consumer and UI proof, an exact terminal event, and one final global failure check."
);
assert.match(npmAssuranceWorkflow, /--lifecycle-self-test --no-open/);
assert.match(npmAssuranceWorkflow, /local-actions --lifecycle-self-test --no-open/);
assert.match(
  npmAssuranceWorkflow,
  /npm-package-preflight-smoke\.mjs[\s\S]*--primary="\$PRIMARY"[\s\S]*--consumer=apps\/studio\/src\/app\/responseSchemas\.ts[\s\S]*NPM_LOCAL_ACTIONS_PREFLIGHT_VERIFIED=passed/
);
assert.match(
  npmAssuranceWorkflow,
  /Copy-Item[^\n]*npm-package-preflight-smoke\.mjs[\s\S]*responseSchemas\.ts[\s\S]*-EntryPoint \$preflightScript[\s\S]*--primary=\$publicPrimary[\s\S]*--consumer=\$preflightConsumer[\s\S]*NPM_LOCAL_ACTIONS_PREFLIGHT_VERIFIED=passed/
);
assert.match(npmAssuranceWorkflow, /fs\.mkdtempSync[\s\S]*unpackedBytes \+= stats\.size[\s\S]*maximum_unpacked_bytes/);
assert.ok((npmAssuranceWorkflow.match(/inspectNpmTarballBytes/g) ?? []).length >= 3);
assert.doesNotMatch(npmAssuranceWorkflow, /files\.join\("\\n"\)/);
assert.match(npmAssuranceWorkflow, /package_file_count=\$\{inspected\.inventory_file_count\}/);
assert.match(npmAssuranceWorkflow, /record\.package_file_count[\s\S]*EXPECTED_PACKAGE_FILE_COUNT/);
assert.match(npmAssuranceWorkflow, /Recheck source cleanliness after restore, build, tests, package, and browser smoke[\s\S]*git diff --exit-code[\s\S]*git diff --cached --exit-code[\s\S]*git status --short --untracked-files=all/);
assert.match(npmAssuranceWorkflow, /New-LocalUser[\s\S]*Start-Process[\s\S]*-Credential \$credential[\s\S]*create-duskds', 'platform-direct-counter'[\s\S]*'--lifecycle-self-test', '--no-open'[\s\S]*'local-actions', '--lifecycle-self-test', '--no-open'/);
assert.match(npmAssuranceWorkflow, /NPM_SAFE_SMOKE=passed[\s\S]*NPM_LOCAL_ACTIONS_PREFLIGHT_VERIFIED=passed[\s\S]*NPM_DIRECT_CLI_SCAFFOLD_SMOKE=passed[\s\S]*NPM_LOCAL_ACTIONS_SCAFFOLD_SMOKE=passed[\s\S]*NPM_SCAFFOLD_PRESERVATION_SMOKE=passed[\s\S]*NPM_SHUTDOWN_SMOKE=passed[\s\S]*NPM_ELEVATED_REFUSAL=passed[\s\S]*all exact-tarball lifecycle and scaffold smokes/);
assert.match(npmAssuranceWorkflow, /NPM_INSTALL_SMOKE=passed[\s\S]*NPM_CLEANUP_SMOKE=passed/);
assert.match(npmAssuranceWorkflow, /rm -rf "\$INSTALL_ROOT"[\s\S]*test ! -e "\$removed"/);
assert.match(npmAssuranceWorkflow, /Windows npm assurance cleanup left a bounded test root behind/);
assert.match(npmAssuranceWorkflow, /Get-CimInstance Win32_UserProfile[\s\S]*Remove-CimInstance[\s\S]*temporary user profile behind/);
assert.match(npmAssuranceWorkflow, /EXPECTED_BROWSER_SMOKE !== "passed"[\s\S]*EXPECTED_LOCAL_ACTIONS_PREFLIGHT_SMOKE !== "passed"[\s\S]*browser_boot_and_pairing_smoke: "passed"/);
assert.match(npmAssuranceWorkflow, /schema_version: 2[\s\S]*install_smoke: "passed"[\s\S]*local_actions_preflight_verified: true[\s\S]*local_actions_preflight_check_id: process\.env\.PREFLIGHT_CHECK_ID[\s\S]*direct_cli_scaffold_smoke: "passed"[\s\S]*local_actions_scaffold_smoke: "passed"[\s\S]*scaffold_preservation_smoke: "passed"[\s\S]*shutdown_smoke: "passed"[\s\S]*cleanup_smoke: "passed"/);
assert.match(npmAssuranceWorkflow, /record\.schema_version !== 2[\s\S]*record\.local_actions_preflight_verified !== true[\s\S]*record\.local_actions_preflight_check_id !== process\.env\.PREFLIGHT_CHECK_ID[\s\S]*record\.direct_cli_scaffold_smoke !== "passed"[\s\S]*record\.local_actions_scaffold_smoke !== "passed"[\s\S]*record\.scaffold_preservation_smoke !== "passed"[\s\S]*record\.shutdown_smoke !== "passed"/);
assert.match(npmAssuranceWorkflow, /record\.local_actions_preflight_loopback_services_stopped !== true/);
assert.match(npmAssuranceWorkflow, /record\.local_actions_preflight_consumer_contract_source_sha256 !== consumerContractSha256/);
assert.match(npmAssuranceWorkflow, /local_actions_preflight_verified: true[\s\S]*consumer_contract_source_sha256: consumerContractSha256[\s\S]*platform_smoke: records/);
assert.match(npmAssuranceWorkflow, /const checkFields = \{[\s\S]*install_smoke[\s\S]*cleanup_smoke[\s\S]*does not prove \$\{check\} through \$\{field\}/);
assert.match(npmAssuranceWorkflow, /receipt\.local_actions_preflight_verified !== true/);
assert.match(npmAssuranceWorkflow, /receipt\.local_actions_preflight_check_id !== process\.env\.PREFLIGHT_CHECK_ID/);
assert.match(npmAssuranceWorkflow, /receipt\.local_actions_scaffold_verified !== true/);
assert.match(npmAssuranceWorkflow, /receipt\.scaffold_preserved_after_shutdown !== true/);
assert.match(npmAssuranceWorkflow, /receipt\.studio_shutdown_verified !== true/);
for (const field of [
  "direct_cli_scaffold_smoke",
  "local_actions_scaffold_smoke",
  "scaffold_preservation_smoke",
  "shutdown_smoke"
]) {
  assert.match(npmAssuranceWorkflow, new RegExp(`${field}: "passed"`));
}
assert.match(npmAssuranceWorkflow, /name: npm-platform-\$\{\{ matrix\.runner \}\}[\s\S]*path: output\/npm\/platform\/npm-platform-\$\{\{ matrix\.runner \}\}\.json/);
assert.match(npmAssuranceWorkflow, /name: studio-npm-assurance-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*path: output\/npm\/studio-npm-assurance-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*archive: false/);
assert.match(npmAssuranceWorkflow, /id: assurance-evidence-upload[\s\S]*name: studio-npm-assurance-evidence-\$\{\{ github\.run_id \}\}\.json[\s\S]*archive: false[\s\S]*artifact-id[\s\S]*artifact-url[\s\S]*artifact-digest/);
assert.match(npmAssuranceWorkflow, /kind: "final-package-assurance"[\s\S]*evidence_class: "package-lifecycle-smoke"[\s\S]*producer: "ci-package-assurance"[\s\S]*capture_mode: "machine-observed"[\s\S]*test_fixture: false/);
assert.match(npmAssuranceWorkflow, /policy_sha256:[\s\S]*source_commit:[\s\S]*package_sha256:[\s\S]*repository_tag:/);
assert.match(npmAssuranceWorkflow, /package_path: `output\/npm\/\$\{process\.env\.EXPECTED_CANDIDATE_ARTIFACT\}`/);
assert.match(npmAssuranceWorkflow, /EVIDENCE_ARTIFACT_DIGEST !== payloadSha256[\s\S]*evidence_payload_sha256: payloadSha256[\s\S]*mode: "github-actions-upload-artifact-v7"[\s\S]*run_id:[\s\S]*run_attempt:[\s\S]*run_event:[\s\S]*run_ref:[\s\S]*run_commit:[\s\S]*artifact_id:[\s\S]*artifact_digest_sha256: payloadSha256/);
assert.ok((npmAssuranceWorkflow.match(/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && github\.run_attempt == 1/g) ?? []).length >= 3);
const comprehensiveValidator = read("scripts/check-comprehensive-validation.mjs");
assert.match(comprehensiveValidator, /downloadGitHubActionsReceipt/);
assert.match(comprehensiveValidator, /expectedRef: "refs\/heads\/main"/);
assert.match(comprehensiveValidator, /independently reverified against the exact successful GitHub run and downloaded artifact bytes/);
assert.match(comprehensiveValidator, /merge-base", "--is-ancestor"/);
assert.match(comprehensiveValidator, /evidence_ledger_commit === finalCandidate\.source_commit/);
assert.match(comprehensiveValidator, /evidence_is_strict_descendant !== true/);
assert.match(comprehensiveValidator, /final_evidence_ledger_paths/);
assert.match(comprehensiveValidator, /fs\.lstat\(absolutePath\)[\s\S]*stat\.isSymbolicLink\(\)[\s\S]*MAX_DURABLE_RECEIPT_BYTES/);
assert.match(comprehensiveValidator, /invalid or oversized compressed payload/);
assert.match(elevatedArchiveStep, /New-LocalUser[\s\S]*Start-Process[\s\S]*-Credential \$credential/);
for (const workflow of [requiredWindowsWorkflow, npmAssuranceWorkflow]) {
  assert.match(workflow, /NODE_BIN="\$\(command -v node\)"[\s\S]*sudo -n "\$NODE_BIN" "\$PRIMARY"/);
  assert.doesNotMatch(workflow, /sudo -n node /);
  assert.match(workflow, /\$dataRoot = Join-Path \$env:PUBLIC[\s\S]*"\*\$\{userSid\}:\(OI\)\(CI\)M"/);
  assert.match(workflow, /\$childEnvironment = @\{[\s\S]*HOME = \$profileRoot[\s\S]*LOCALAPPDATA = \$localAppData[\s\S]*USERPROFILE = \$profileRoot[\s\S]*-Environment \$childEnvironment/);
  assert.match(workflow, /\$elevatedStatus = \$LASTEXITCODE[\s\S]*?Dusk Developer Studio refuses elevated or root execution\.[\s\S]*?finally \{[\s\S]*?(?:Remove-Item -LiteralPath \$dataRoot -Recurse -Force|foreach \(\$cleanupRoot in @\(\$publicRoot, \$dataRoot\)\)[\s\S]*?Remove-Item -LiteralPath \$cleanupRoot -Recurse -Force)[\s\S]*?\$global:LASTEXITCODE = 0/);
  assert.match(workflow, /(?:Test-Path -LiteralPath \$dataRoot[\s\S]*Remove-Item -LiteralPath \$dataRoot -Recurse -Force|foreach \(\$cleanupRoot in @\(\$publicRoot, \$dataRoot\)\)[\s\S]*Test-Path -LiteralPath \$cleanupRoot[\s\S]*Remove-Item -LiteralPath \$cleanupRoot -Recurse -Force)/);
}
assert.match(npmAssuranceWorkflow, /Get-LocalUser -Name \$userName -ErrorAction SilentlyContinue[\s\S]*temporary local account behind/);

const npmPublishWorkflow = read(".github/workflows/studio-npm-publish.yml");
assert.match(npmPublishWorkflow, /^ {4}tags:\n {6}- v1\.0\.0$/m);
assert.match(npmPublishWorkflow, /contents: read[\s\S]*id-token: write/);
assert.equal((npmPublishWorkflow.match(/secrets\.NPM_INITIAL_PUBLISH_TOKEN/g) ?? []).length, 1);
assert.match(npmPublishWorkflow, /environment: npm-initial-publication/);
assert.match(npmPublishWorkflow, /registry-url: https:\/\/registry\.npmjs\.org/);
assert.doesNotMatch(npmPublishWorkflow, /NPM_TOKEN:\s*\$\{\{|long_lived_token|sigstore_provenance_verified/);
assert.match(npmPublishWorkflow, /test "\$GITHUB_REF_NAME" = "v1\.0\.0"/);
assert.match(npmPublishWorkflow, /git rev-parse "refs\/tags\/\$GITHUB_REF_NAME\^\{commit\}"/);
assert.match(npmPublishWorkflow, /git rev-parse refs\/remotes\/origin\/main\)" = "\$GITHUB_SHA"/);
assert.match(npmPublishWorkflow, /manifest\.name !== "dusk-developer-studio"[\s\S]*manifest\.version !== "1\.0\.0"/);
assert.match(npmPublishWorkflow, /ASSURED_CANDIDATE_ARTIFACT[\s\S]*Download the exact candidate exercised by all platform lanes/);
assert.doesNotMatch(npmPublishWorkflow, /pnpm build:npm|pnpm test:npm|pnpm pack:npm/);
assert.match(npmPublishWorkflow, /REGISTRY_OUTCOME=verified-existing|outcome = "verified-existing"/);
assert.match(npmPublishWorkflow, /npm publish "\$TARBALL" --access public --provenance/);
assert.match(npmPublishWorkflow, /npm whoami --registry=https:\/\/registry\.npmjs\.org[\s\S]*test "\$OBSERVED_NPM_MAINTAINER" = "\$EXPECTED_NPM_MAINTAINER"[\s\S]*npm publish "\$TARBALL" --access public --provenance/);
assert.match(npmPublishWorkflow, /npm install --ignore-scripts --no-audit --no-fund --save-exact --registry=https:\/\/registry\.npmjs\.org dusk-developer-studio@1\.0\.0[\s\S]*package-lock\.json[\s\S]*node_modules\/dusk-developer-studio[\s\S]*record\.integrity !== process\.env\.LOCAL_NPM_INTEGRITY[\s\S]*npm audit signatures/);
assert.doesNotMatch(npmPublishWorkflow, /--package-lock-only/);
assert.match(npmPublishWorkflow, /npm audit signatures --registry=https:\/\/registry\.npmjs\.org/);
assert.match(npmPublishWorkflow, /verify-npm-provenance\.mjs[\s\S]*--publication=initial/);
assert.match(npmPublishWorkflow, /provenance_verification: "npm-audit-signatures-and-slsa-source-bound"/);
assert.match(npmPublishWorkflow, /name: studio-npm-publication-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*path: output\/npm\/studio-npm-publication-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*archive: false/);
assert.doesNotMatch(npmPublishWorkflow, /\bbeta\b|\bfinal\b|release candidate|internal-rc|prototype/i);
const npmOidcWorkflow = read(".github/workflows/studio-npm-oidc-publish.yml");
assert.match(npmOidcWorkflow, /github\.ref_name != 'v1\.0\.0'/);
assert.match(npmOidcWorkflow, /actions: read[\s\S]*id-token: write/);
assert.match(npmOidcWorkflow, /environment: npm-trusted-publication/);
assert.match(npmOidcWorkflow, /registry-url: https:\/\/registry\.npmjs\.org/);
assert.match(npmOidcWorkflow, /test -z "\$\{NODE_AUTH_TOKEN:-\}"[\s\S]*npm publish "\$TARBALL" --access public --provenance/);
assert.match(npmOidcWorkflow, /npm install --ignore-scripts --no-audit --no-fund --save-exact --registry=https:\/\/registry\.npmjs\.org "dusk-developer-studio@\$PACKAGE_VERSION"[\s\S]*package-lock\.json[\s\S]*node_modules\/dusk-developer-studio[\s\S]*process\.env\.GITHUB_REF_NAME\.slice\(1\)[\s\S]*record\.integrity !== process\.env\.LOCAL_NPM_INTEGRITY[\s\S]*npm audit signatures/);
assert.doesNotMatch(npmOidcWorkflow, /--package-lock-only/);
assert.match(npmOidcWorkflow, /npm audit signatures --registry=https:\/\/registry\.npmjs\.org/);
assert.match(npmOidcWorkflow, /verify-npm-provenance\.mjs[\s\S]*--publication=subsequent/);
assert.match(
  npmOidcWorkflow,
  /fs\.mkdirSync\("output\/npm", \{ recursive: true \}\);[\s\S]*fs\.writeFileSync\(`output\/npm\/studio-npm-oidc-publication-receipt-/,
  "The OIDC publication job must create its receipt directory before the fail-closed receipt write."
);
assert.match(npmOidcWorkflow, /publisher\?\.name !== policy\.publication\.expected_oidc_publisher[\s\S]*publisher\?\.trustedPublisher\?\.id !== policy\.publication\.expected_oidc_trusted_publisher_id/);
assert.match(npmOidcWorkflow, /record\.replace\(\/\\s\+<\[\^>\]\+>\$\/u, ""\)\.trim\(\)[\s\S]*npmPublisher !== policy\.publication\.expected_oidc_publisher/);
assert.match(npmOidcWorkflow, /registryPublisher\?\.name !== policy\.publication\.expected_oidc_publisher[\s\S]*registryPublisher\?\.trustedPublisher\?\.id !== policy\.publication\.expected_oidc_trusted_publisher_id/);
assert.match(npmOidcWorkflow, /GITHUB_API_TOKEN: \$\{\{ github\.token \}\}[\s\S]*resolve-main-assurance-artifact\.mjs[\s\S]*--repository=\$GITHUB_REPOSITORY[\s\S]*--commit=\$GITHUB_SHA[\s\S]*--workflow=\.github\/workflows\/studio-npm-package-assurance\.yml/);
assert.match(npmOidcWorkflow, /Download the reviewed main-push candidate[\s\S]*artifact-ids: \$\{\{ steps\.main-assurance\.outputs\.artifact_id \}\}[\s\S]*run-id: \$\{\{ steps\.main-assurance\.outputs\.run_id \}\}[\s\S]*github-token: \$\{\{ github\.token \}\}/);
assert.match(npmOidcWorkflow, /Download the tag-run candidate exercised by all platform lanes[\s\S]*prepublication-candidate-binding\.mjs[\s\S]*--main=output\/main-assurance\/[\s\S]*--tag=output\/tag-assurance\//);
assert.match(npmOidcWorkflow, /main_assurance_artifact_digest_sha256:[\s\S]*prepublication_cross_run_byte_match:/);
assert.doesNotMatch(npmOidcWorkflow, /npmUser !== policy\.publication\.expected_npm_maintainer/);
assert.doesNotMatch(npmOidcWorkflow, /secrets\.|NPM_INITIAL_PUBLISH_TOKEN/);
for (const receiptBinding of [
  /node_engine: policy\.package\.node_engine/,
  /registry_url: `\$\{policy\.package\.registry\}\/\$\{policy\.package\.name\}`/,
  /tag: policy\.package\.tag/,
  /workflow_path: policy\.publication\.workflow_path/,
  /package_inventory_sha256: process\.env\.ASSURED_PACKAGE_INVENTORY_SHA256/,
  /registry_authentication: process\.env\.PUBLICATION_OUTCOME === "published"/
]) {
  assert.match(npmOidcWorkflow, receiptBinding);
}
const prepublicationBinding = read("scripts/prepublication-candidate-binding.mjs");
assert.match(prepublicationBinding, /timingSafeEqual/);
assert.match(prepublicationBinding, /Tag assurance rebuilt different bytes from the reviewed main-push candidate/);
assert.match(prepublicationBinding, /inspectNpmTarballBytes\(main\.bytes\)[\s\S]*inspectNpmTarballBytes\(tag\.bytes\)/);
assert.match(packageJson.scripts.test, /test-prepublication-candidate-binding\.mjs/);
const mainAssuranceResolver = read("scripts/resolve-main-assurance-artifact.mjs");
assert.match(mainAssuranceResolver, /run\.head_sha === requirement\.commit[\s\S]*run\.head_branch === "main"[\s\S]*run\.event === "push"[\s\S]*run\.run_attempt === 1/);
assert.match(mainAssuranceResolver, /artifact\.workflow_run\?\.head_sha === requirement\.commit[\s\S]*sha256:\[a-f0-9\]\{64\}/);
assert.match(mainAssuranceResolver, /actions\/workflows\/\$\{encodeURIComponent\(requirement\.workflowPath\)\}\/runs\?branch=main&event=push&status=success&head_sha=\$\{encodeURIComponent\(requirement\.commit\)\}&per_page=100/);
assert.match(mainAssuranceResolver, /artifact_id=\$\{resolved\.artifact_id\}/);
assert.match(packageJson.scripts.test, /test-resolve-main-assurance-artifact\.mjs/);
const npmProvenanceVerifier = read("scripts/verify-npm-provenance.mjs");
assert.match(npmProvenanceVerifier, /published\.dist\.attestations\.url[\s\S]*\/-\/npm\/v1\/attestations\//);
assert.match(npmProvenanceVerifier, /expectedSubject = `pkg:npm\/\$\{policy\.package\.name\}@\$\{policy\.package\.version\}`/);
assert.match(npmProvenanceVerifier, /workflow\.repository !== policy\.publication\.expected_provenance_repository[\s\S]*workflow\.path !== expectedWorkflow[\s\S]*workflow\.ref !== expectedRef/);
assert.match(npmProvenanceVerifier, /resolvedDependencies\.length !== 1[\s\S]*gitCommit !== commit/);

const publicStagingWorkflow = read(".github/workflows/studio-public-staging.yml");
assert.match(publicStagingWorkflow, /^name: Studio public deployment assurance$/m);
assert.match(publicStagingWorkflow, /^"on":\n {2}schedule:\n {4}- cron: "23 \*\/6 \* \* \*"\n {2}workflow_dispatch:/m);
assert.doesNotMatch(publicStagingWorkflow, /^ {2}(?:push|pull_request):/m);
assert.match(publicStagingWorkflow, /--commit="\$GITHUB_SHA"/);
assert.match(publicStagingWorkflow, /--rpc-degradation="\$\{\{ steps\.browser\.outcome \}\}"/);
assert.match(publicStagingWorkflow, /issues: write/);
assert.match(publicStagingWorkflow, /gh issue create[\s\S]*--assignee GeorgianDusk/);
assert.match(publicStagingWorkflow, /gh issue close/);
assert.match(publicStagingWorkflow, /schema_version: 2[\s\S]*candidate_commit: process\.env\.GITHUB_SHA[\s\S]*candidate_public_fingerprint_sha256: process\.env\.PUBLIC_FINGERPRINT/);
assert.match(publicStagingWorkflow, /issue_closed: true[\s\S]*studio-alert-delivery-receipt-\$\{\{ github\.run_id \}\}/);
assert.match(publicStagingWorkflow, /studio-public-synthetic-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*archive: false/);
assert.doesNotMatch(publicStagingWorkflow, /STUDIO_MONITOR_HEARTBEAT|EXTERNAL_HEARTBEAT|external_heartbeat|external_failure/);
assert.match(publicStagingWorkflow, /vars\.DUSK_STUDIO_PUBLIC_URL/);
assert.match(publicStagingWorkflow, /vars\.DUSK_STUDIO_PUBLIC_ENVIRONMENT/);
assert.doesNotMatch(publicStagingWorkflow, /default:\s*https?:\/\//);
assert.match(publicStagingWorkflow, /expected_environment:[\s\S]*default: repository-default[\s\S]*- repository-default/);
assert.match(publicStagingWorkflow, /case "\$EXPECTED_ENVIRONMENT" in staging\|production/);
assert.match(publicStagingWorkflow, /validateAssuranceTargetOrigin\(process\.env\.TARGET_URL, policy\)/);
assert.ok(publicStagingWorkflow.indexOf("validateAssuranceTargetOrigin(process.env.TARGET_URL, policy)") < publicStagingWorkflow.indexOf("run: pnpm e2e:public"), "Target policy must be validated before Playwright makes network requests.");
assert.match(publicStagingWorkflow, /Studio upstream dependency unavailable/);
assert.match(publicStagingWorkflow, /steps\.classification\.outputs\.studio_status/);
assert.match(publicStagingWorkflow, /selectAssuranceIncidentTitle/);
assert.match(publicStagingWorkflow, /selectAssuranceIncidentTitle\(process\.env\.BROWSER_OUTCOME, process\.env\.SYNTHETIC_OUTCOME, classification\)/);
assert.doesNotMatch(publicStagingWorkflow, /selectScheduledHeartbeatSignal|heartbeat_signal/);
assert.match(publicStagingWorkflow, /Monitoring mode: GitHub-only under docs\/operations\/public-monitoring\.md/);
assert.match(publicStagingWorkflow, /for other_title in "Studio public deployment assurance failed" "Studio upstream dependency unavailable"/);
assert.match(publicStagingWorkflow, /Reclassified into #\$issue by failed scheduled assurance/);
assert.ok(publicStagingWorkflow.indexOf('issue_url="$(gh issue create') < publicStagingWorkflow.indexOf('for other_title in "Studio public deployment assurance failed"'), "The selected incident must be open before other component titles are reclassified.");
const duskDsNativeSmokeWorkflow = read(".github/workflows/duskds-native-smoke.yml");
const duskDsToolchainPolicy = JSON.parse(read("config/duskds-toolchain-policy.json"));
assert.equal(
  cargoAdvisoryPolicy.lock_sha256,
  duskDsToolchainPolicy.dusk_forge.reviewed_template.template_lock_sha256
);
assert.equal(duskDsToolchainPolicy.schema_version, 1);
assert.equal(duskDsToolchainPolicy.rust_toolchain, "1.94.0");
assert.deepEqual(duskDsToolchainPolicy.dusk_forge, {
  repository: "https://github.com/dusk-network/forge",
  package: "dusk-forge-cli",
  package_version: "0.1.0",
  dependency_snapshot_sha256: null,
  binary: "dusk-forge",
  revision: "d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a",
  reviewed_template: {
    id: "duskds-counter-forge",
    generated_lock_sha256: "6657e6da48dc245860aa8575b0633d88e0cdd7fcedce524789c682d246284ea4",
    template_lock_sha256: "1408051342213d41a91342497b18856c87afc3bc0eeb1c750932e634525445da"
  }
});
assert.deepEqual(duskDsToolchainPolicy.w3sper, { version: "1.6.0" });
assert.deepEqual(duskDsToolchainPolicy.rusk, {
  tag: "dusk-core-1.6.0",
  revision: "ae1a38a2079c681126a96f94c17d282ea2639946"
});
assert.match(duskDsNativeSmokeWorkflow, /^name: DuskDS native production smoke$/m);
assert.match(duskDsNativeSmokeWorkflow, /runs-on: ubuntu-24\.04/);
assert.match(duskDsNativeSmokeWorkflow, /persist-credentials: "false"/);
assert.match(duskDsNativeSmokeWorkflow, /EXPECTED_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
assert.match(duskDsNativeSmokeWorkflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}[\s\S]*git rev-parse HEAD\)" = "\$EXPECTED_COMMIT"/);
assert.match(duskDsNativeSmokeWorkflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020[\s\S]*node-version: 24\.18\.0/);
assert.match(duskDsNativeSmokeWorkflow, /config\/duskds-toolchain-policy\.json/);
assert.match(duskDsNativeSmokeWorkflow, /`RUST_TOOLCHAIN=\$\{policy\.rust_toolchain\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`FORGE_COMMIT=\$\{policy\.dusk_forge\.revision\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`DUSKDS_TEMPLATE_ID=\$\{policy\.dusk_forge\.reviewed_template\.id\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`DUSKDS_GENERATED_LOCK_SHA256=\$\{policy\.dusk_forge\.reviewed_template\.generated_lock_sha256\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`DUSKDS_TEMPLATE_LOCK_SHA256=\$\{policy\.dusk_forge\.reviewed_template\.template_lock_sha256\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`RUSK_TAG=\$\{policy\.rusk\.tag\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`RUSK_COMMIT=\$\{policy\.rusk\.revision\}`/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /FORGE_COMMIT:\s*[0-9a-f]{40}/);
assert.match(duskDsNativeSmokeWorkflow, /grep -Fq "\$FORGE_COMMIT" "\$RUNNER_TEMP\/dusk-forge\/\.crates2\.json"/);
assert.match(duskDsNativeSmokeWorkflow, /corepack install --global pnpm@11\.7\.0/);
assert.match(duskDsNativeSmokeWorkflow, /pnpm install --frozen-lockfile/);
assert.match(duskDsNativeSmokeWorkflow, /pnpm build:npm[\s\S]*pnpm test:npm/);
assert.match(duskDsNativeSmokeWorkflow, /cd "\$ROOT"[\s\S]*node "\$GITHUB_WORKSPACE\/output\/npm\/package\/bin\/dusk-developer-studio\.mjs" create-duskds duskds-phase5-smoke/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /\bdusk-forge(?:\.exe)?\s+new\b/u);
assert.match(duskDsNativeSmokeWorkflow, /TEMPLATE="output\/npm\/package\/templates\/\$DUSKDS_TEMPLATE_ID"[\s\S]*PROVENANCE\.md/);
assert.match(duskDsNativeSmokeWorkflow, /sha256sum "\$TEMPLATE\/Cargo\.lock"[\s\S]*= "\$DUSKDS_TEMPLATE_LOCK_SHA256"/);
assert.match(duskDsNativeSmokeWorkflow, /grep -Fq "\$DUSKDS_GENERATED_LOCK_SHA256" "\$TEMPLATE\/PROVENANCE\.md"/);
assert.match(duskDsNativeSmokeWorkflow, /grep -Fq "\$FORGE_COMMIT" "\$PROJECT\/PROVENANCE\.md"/);
assert.ok(
  duskDsNativeSmokeWorkflow.indexOf("Build and verify the Studio npm package")
    < duskDsNativeSmokeWorkflow.indexOf("Scaffold through the reviewed Studio package"),
  "The native smoke must verify the package before using its DuskDS scaffold command."
);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge check/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge build all/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge test/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge verify --skip-build/);
assert.match(duskDsNativeSmokeWorkflow, /candidate_artifact_fingerprint_sha256:[\s\S]*CANDIDATE_ARTIFACT_FINGERPRINT_SHA256/);
assert.match(duskDsNativeSmokeWorkflow, /CONTRACT_SHA256=\$CONTRACT_HASH[\s\S]*DATA_DRIVER_SHA256=\$DRIVER_HASH/);
assert.match(duskDsNativeSmokeWorkflow, /contract_sha256: process\.env\.CONTRACT_SHA256[\s\S]*data_driver_sha256: process\.env\.DATA_DRIVER_SHA256/);
assert.match(duskDsNativeSmokeWorkflow, /scripts\/staging-smoke\.mjs/);
assert.match(duskDsNativeSmokeWorkflow, /checkDuskDsNodeRead\(policy\.duskds_testnet_graphql_url\)/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /curl[\s\S]*DUSKDS_GRAPHQL_URL|\.data\.block\.header|DUSKDS_GRAPHQL_URL/);
assert.ok(duskDsNativeSmokeWorkflow.indexOf("Read the official DuskDS Testnet node") < duskDsNativeSmokeWorkflow.indexOf("Install the pinned Rust and Dusk Forge toolchain"), "The bounded node read must fail fast before the expensive native toolchain install.");
assert.match(duskDsNativeSmokeWorkflow, /git\+https:\/\/github\.com\/dusk-network\/rusk\?tag=\$RUSK_TAG#\$RUSK_COMMIT/);
assert.match(duskDsNativeSmokeWorkflow, /GITHUB_STEP_SUMMARY/);
assert.match(duskDsNativeSmokeWorkflow, /output\/duskds-native-smoke-receipt-\$\{process\.env\.GITHUB_RUN_ID\}\.json/);
assert.match(duskDsNativeSmokeWorkflow, /duskds-native-smoke-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*archive: false/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /contents:\s*write|secrets\./);
const publicReleaseSpec = read("tests/e2e/public-release.spec.ts");
assert.match(publicReleaseSpec, /request\.get\(expected\.href, \{ maxRedirects: 0 \}\)/);
assert.match(publicReleaseSpec, /context\.route\("\*\*\/\*"/);
assert.match(publicReleaseSpec, /route\.abort\("blockedbyclient"\)/);
assert.match(publicReleaseSpec, /requestUrl\.origin !== publicOrigin/);
assert.match(publicReleaseSpec, /rpc\.testnet\.evm\.dusk\.network/);
assert.match(publicReleaseSpec, /redirectedFrom\(\)/);
assert.match(publicReleaseSpec, /await expect\(page, pathname\)\.toHaveURL\(expected\.href\)/);
assert.match(publicReleaseSpec, /evmCanonicalRoutes = \["access", "build", "inspect"\][\s\S]*toHaveURL\(`\$\{publicOrigin\}\/#setup`\)/);
const publicMonitoring = read("docs/operations/public-monitoring.md");
assert.match(publicMonitoring, /Both controls use GitHub Actions and GitHub Issues/);
assert.match(publicMonitoring, /GitHub outage can affect monitoring and alert delivery at the same time/);
assert.doesNotMatch(publicMonitoring, /STUDIO_MONITOR_HEARTBEAT/);

const caddyWorkflow = read(".github/workflows/platform-caddy-security.yml");
assert.match(caddyWorkflow, /sudo install -d -m 0755[\s\S]*\/var\/log\/caddy/);
assert.match(caddyWorkflow, /\/tmp\/caddy validate --config "\$fragment" --adapter caddyfile/);

function assertStableScopedContext({ workflow, contextName, classifierName, heavySteps }) {
  assert.match(workflow, /pull_request:\n {4}branches: \[main\]\n {2}push:/, `${contextName} must instantiate on every pull request to main.`);
  assert.match(workflow, /push:\n {4}branches: \[main\]\n {4}paths:/, `${contextName} must retain push path filtering.`);
  assert.match(workflow, new RegExp(`name: ${contextName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(workflow, new RegExp(`- name: ${classifierName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*id: scope`));
  assert.match(workflow, /changed_paths="\$RUNNER_TEMP\/[^"]+"/);
  assert.match(workflow, /git diff --no-renames --name-only -z "\$BASE_SHA\.\.\.\$HEAD_SHA" > "\$changed_paths"/);
  assert.match(workflow, /done < "\$changed_paths"/);
  assert.doesNotMatch(workflow, /done < <\(git diff/, `${contextName} must not hide a failed diff inside process substitution.`);
  assert.match(workflow, /test -n "\$BASE_SHA"[\s\S]*test -n "\$HEAD_SHA"[\s\S]*git cat-file -e "\$BASE_SHA\^\{commit\}"[\s\S]*git cat-file -e "\$HEAD_SHA\^\{commit\}"/);
  assert.match(workflow, /- name: Report scope-only success\n {8}if: steps\.scope\.outputs\.relevant == 'false'/);
  assert.doesNotMatch(workflow, /^ {4}if: .*scope/m, `${contextName} must not use a job-level scope condition.`);
  for (const stepName of heavySteps) {
    const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(workflow, new RegExp(`- name: ${escaped}\\n {8}if: steps\\.scope\\.outputs\\.relevant == 'true'`), `${stepName} must be scope-gated.`);
  }
}

assertStableScopedContext({
  workflow: duskDsNativeSmokeWorkflow,
  contextName: "Exact DuskDS scaffold, build, VM test, and inspection",
  classifierName: "Classify DuskDS native-smoke scope",
  heavySteps: [
    "Use the verified Node.js line",
    "Load the reviewed DuskDS toolchain policy",
    "Read the official DuskDS Testnet node",
    "Enable repository-pinned pnpm",
    "Restore frozen dependencies",
    "Build and verify the Studio npm package",
    "Install the pinned Rust and Dusk Forge toolchain",
    "Verify required native tools",
    "Scaffold through the reviewed Studio package",
    "Check, build both artifacts, and run the Linux VM test",
    "Inspect and record bounded artifact evidence"
  ]
});
assertStableScopedContext({
  workflow: caddyWorkflow,
  contextName: "Validate static-only Caddy fragment",
  classifierName: "Classify Caddy security scope",
  heavySteps: [
    "Install checksum-pinned Caddy",
    "Enforce the static-hosting boundary"
  ]
});

const watchdogWorkflow = read(".github/workflows/studio-monitor-schedule-guard.yml");
assert.match(watchdogWorkflow, /^"on":\n {2}schedule:\n {4}- cron: "47 4,16 \* \* \*"\n {2}workflow_dispatch:/m);
assert.match(watchdogWorkflow, /actions: read/);
assert.match(watchdogWorkflow, /issues: write/);
assert.match(watchdogWorkflow, /node scripts\/monitor-heartbeat\.mjs --max-age-hours=15/);
assert.match(watchdogWorkflow, /studio-monitor-heartbeat-\$GITHUB_RUN_ID\.json[\s\S]*archive: false/);
assert.match(watchdogWorkflow, /gh issue create[\s\S]*--assignee GeorgianDusk/);
assert.match(watchdogWorkflow, /ref: \$\{\{ github\.sha \}\}[\s\S]*git rev-parse HEAD/);

const phase5Policy = JSON.parse(read("config/phase5-policy.json"));
const phase5Checker = read("scripts/check-phase5-evidence.mjs");
const phase5CandidateContext = read("scripts/phase5-candidate-context.mjs");
const phase5Evaluator = read("scripts/phase5-evidence.mjs");
const phase5ProvenanceVerifier = read("scripts/github-actions-provenance.mjs");
const agentPilotCollector = read("scripts/agent-pilot-collector.mjs");
const agentPilotPlan = read("scripts/agent-pilot-plan.mjs");
const agentPilotAssembler = read("scripts/assemble-agent-pilot-evidence.mjs");
const stagingSmoke = read("scripts/staging-smoke.mjs");
assert.match(phase5Checker, /GH_TOKEN[\s\S]*GITHUB_TOKEN[\s\S]*evaluatePhase5EvidenceOnline/);
assert.match(phase5Checker, /verifyCandidateBoundPhase5Context[\s\S]*policyBytes[\s\S]*candidateContext/);
assert.match(phase5CandidateContext, /rev-parse[\s\S]*status[\s\S]*--untracked-files=no[\s\S]*cat-file/);
assert.match(phase5CandidateContext, /scripts\/agent-pilot-collector\.mjs/);
assert.match(phase5CandidateContext, /scripts\/agent-pilot-plan\.mjs/);
assert.match(phase5CandidateContext, /scripts\/assemble-agent-pilot-evidence\.mjs/);
assert.match(phase5CandidateContext, /docs\/evidence\/npm-initial-publication-receipt-29686128164\.json/);
assert.match(phase5ProvenanceVerifier, /run_attempt !== 1/);
assert.match(phase5ProvenanceVerifier, /redirect: "manual"[\s\S]*redirect: "error"/);
assert.match(phase5ProvenanceVerifier, /does not have exactly one run-scoped receipt artifact/);
assert.match(phase5ProvenanceVerifier, /artifactExpiresAt/);
assert.match(phase5ProvenanceVerifier, /verifyExactNpmPackageSignatures/);
assert.match(phase5ProvenanceVerifier, /npm-registry-slsa-fallback[\s\S]*cryptographic_verifier/);
assert.match(phase5ProvenanceVerifier, /"audit",[\s\S]*"signatures"/);
assert.match(phase5ProvenanceVerifier, /label: "npm initial publication"[\s\S]*historicalInitialPublication: true/);
assert.match(phase5ProvenanceVerifier, /label: "npm package assurance"[\s\S]*event: "push"[\s\S]*expectedRef: "refs\/heads\/main"/);
assert.match(phase5ProvenanceVerifier, /verifyGitHubActionsArtifactBytes[\s\S]*MAX_PACKAGE_ARTIFACT_BYTES/);
assert.match(phase5ProvenanceVerifier, /label: "npm package assurance evidence payload"[\s\S]*label: "npm reviewed main-push candidate"/);
assert.match(read("package.json"), /scripts\/test-github-actions-provenance\.mjs/);
assert.match(read("package.json"), /scripts\/test-agent-pilot-collector\.mjs/);
assert.match(read("package.json"), /scripts\/test-agent-pilot-plan\.mjs/);
assert.match(read("package.json"), /scripts\/test-agent-pilot-evidence-assembler\.mjs/);
assert.match(agentPilotCollector, /operator-attested-machine-collected/);
assert.match(agentPilotCollector, /canonicalSha256\(result\.receipt\.plan\)/);
assert.match(agentPilotCollector, /const packageInventory = validateManifestFiles\(records, manifest\);/);
assert.match(agentPilotCollector, /const packageInventorySha256 = canonicalSha256\(packageInventory\);/);
assert.match(agentPilotCollector, /package_file_count: packageInventory\.length/);
assert.doesNotMatch(agentPilotCollector, /records\.map\(\(record\) => record\.path\)\.join/);
assert.doesNotMatch(
  read("scripts/check-comprehensive-validation.mjs"),
  /export function validateComprehensiveCampaignTestFixture/
);
assert.match(agentPilotPlan, /win-keyboard-recovery/);
assert.match(agentPilotCollector, /operator-attested-machine-collected/);
assert.match(agentPilotCollector, /independent_execution: false/);
assert.match(agentPilotCollector, /raw_observation_bundle_sha256/);
assert.match(agentPilotCollector, /github_actions_provenance_input/);
assert.match(stagingSmoke, /artifactFingerprintFromRecords\(manifest\?\.artifacts\)/);
assert.doesNotMatch(stagingSmoke, /sha256\(JSON\.stringify\(manifest\.artifacts\)\)/);
assert.match(agentPilotAssembler, /verifyAgentPilotResult\(wrapper\)/);
assert.match(agentPilotAssembler, /downloadGitHubActionsReceipt/);
assert.match(agentPilotAssembler, /envelope\.ref !== "refs\/heads\/main"/);
assert.match(agentPilotAssembler, /flag: "wx"/);
assert.deepEqual(phase5Policy.production_paths, ["duskds"]);
assert.deepEqual(phase5Policy.preview_paths, ["evm"]);
assert.deepEqual(phase5Policy.candidate_hosts, [
  "studio.134-122-59-217.nip.io"
]);
assert.deepEqual(phase5Policy.compatibility_hosts, [
  "studio.134-122-59-217.sslip.io"
]);
assert.equal(phase5Policy.minimum_tls_days_remaining, 14);
assert.deepEqual(phase5Policy.required_owners, [
  "product", "engineering", "protocol_docs", "security", "platform", "brand", "accessibility", "devrel_support"
]);
assert.deepEqual(phase5Policy.required_reviews, ["companion_security", "platform", "accessibility"]);
assert.deepEqual(phase5Policy.responsibility_model, {
  mode: "single-human-owner-with-codex-agent-execution",
  human_owner: "George",
  agent_operator: "Codex",
  role_reuse_allowed: true,
  review_model: "separate-codex-subagent-challenge-reviews",
  reviewer_type: "codex-subagent",
  external_independent_review: false,
  fixed_limitation: "Owner fields identify accountability to George rather than distinct people; separate Codex subagent challenge reviews are not external independent human or security audits."
});
assert.deepEqual(phase5Policy.pilot, {
  evidence_class: "agent-operated-simulations",
  operator_type: "codex-agent",
  operator_identity: "Codex",
  confidence_score_semantics: "heuristic-agent-confidence-not-human-trust",
  receipt_assurance: "operator-attested-hash-bound-not-independent-execution-proof",
  fixed_limitation: "Agent-operated Codex simulations provide reproducible flow coverage but do not prove external-human comprehension, usability, confidence, or adoption; receipt hashes bind operator-attested evidence bytes but do not independently prove execution, Linux and macOS additionally require GitHub Actions run and artifact provenance, and Windows and WSL remain operator-attested machine-collected evidence rather than independent validation.",
  minimum_total: 8,
  minimum_duskds: 8,
  required_scenarios: [
    {
      id: "win-safe-boundary",
      context: "windows",
      experience: "novice",
      capability: "mode-boundary",
      execution_surface: "local-safe-to-local-actions",
      failure_class: "safe-mode-machine-action-refusal"
    },
    {
      id: "win-keyboard-recovery",
      context: "windows",
      experience: "novice",
      capability: "keyboard-accessibility",
      execution_surface: "local-browser",
      failure_class: "empty-search-result"
    },
    {
      id: "win-containment-recovery",
      context: "windows",
      experience: "experienced",
      capability: "path-containment",
      execution_surface: "local-actions",
      failure_class: "outside-root-parent-refusal"
    },
    {
      id: "win-overwrite-refusal",
      context: "windows",
      experience: "experienced",
      capability: "overwrite-protection",
      execution_surface: "direct-cli",
      failure_class: "existing-target-refusal"
    },
    {
      id: "wsl-managed-root-recovery",
      context: "wsl",
      experience: "novice",
      capability: "managed-root-safety",
      execution_surface: "local-actions-wsl",
      failure_class: "unsafe-managed-root-refusal"
    },
    {
      id: "wsl-native-toolchain-recovery",
      context: "wsl",
      experience: "experienced",
      capability: "native-toolchain",
      execution_surface: "native-duskds-wsl",
      failure_class: "toolchain-mismatch"
    },
    {
      id: "linux-port-conflict-recovery",
      context: "linux",
      experience: "experienced",
      capability: "loopback-port-safety",
      execution_surface: "local-runtime-linux",
      failure_class: "loopback-port-conflict"
    },
    {
      id: "macos-privilege-recovery",
      context: "macos",
      experience: "experienced",
      capability: "privilege-boundary",
      execution_surface: "local-runtime-macos",
      failure_class: "elevated-execution-refusal"
    }
  ],
  required_experience: ["novice", "experienced"],
  required_contexts: ["windows", "wsl", "linux", "macos"],
  local_operator_attested_contexts: ["windows", "wsl"],
  github_actions_provenance_contexts: ["linux", "macos"],
  required_observation_kinds: ["command", "file-probe", "hash-probe"],
  minimum_completion_rate: 1,
  minimum_recovery_rate: 1,
  maximum_blocking_confusion: 0
});
assert.deepEqual(phase5Policy.required_synthetic_checks, [
  "public_health", "release_parity", "key_routes", "source_links", "duskds_node_read",
  "rpc_degradation", "tls_expiry", "companion_port_closed", "development_port_closed", "monitor_heartbeat"
]);
assert.deepEqual(phase5Policy.rollback_targets_seconds, { product: 300, platform: 600 });
assert.equal(phase5Policy.duskds_testnet_graphql_url, "https://testnet.nodes.dusk.network/on/graphql/query");
assert.ok(phase5Policy.duskds_node_read_evidence.max_age_hours > 0);
assert.ok(phase5Policy.duskds_node_read_evidence.max_receipt_skew_minutes > 0);
assert.equal(phase5Policy.deferred_synthetic_checks.rpc_chain_id.path, "evm");
assert.match(phase5Policy.deferred_synthetic_checks.rpc_chain_id.reason, /Testnet is not live/i);
assert.ok(phase5Policy.deferred_synthetic_checks.rpc_chain_id.activation_requirements.some((requirement) => /real DuskEVM Testnet RPC/i.test(requirement)));
assert.ok(!phase5Policy.required_synthetic_checks.includes("rpc_chain_id"));
assert.ok(phase5Policy.required_synthetic_checks.includes("duskds_node_read"));
assert.deepEqual(phase5Policy.required_native_smoke_steps, ["preflight", "node_read", "scaffold", "build_artifacts", "vm_test", "inspect"]);
assert.equal(phase5Policy.pilot.minimum_duskds, phase5Policy.pilot.minimum_total);
assert.equal(Object.hasOwn(phase5Policy, "companion_distribution"), false);
assert.deepEqual(phase5Policy.npm_distribution, {
  package_name: "dusk-developer-studio",
  package_version: "1.0.5",
  tag: "v1.0.5",
  registry_url: "https://registry.npmjs.org/dusk-developer-studio",
  node_engine: ">=24.18.0 <25",
  assurance_workflow: ".github/workflows/studio-npm-package-assurance.yml",
  publication_workflow: ".github/workflows/studio-npm-oidc-publish.yml",
  publication_environment: "npm-trusted-publication",
  initial_package_version: "1.0.0",
  initial_tag: "v1.0.0",
  initial_publication_environment: "npm-initial-publication",
  initial_publication_evidence: initialPublicationEvidence,
  initial_registry_authentication: "short-lived-granular-token",
  initial_token_max_lifetime_hours: 24,
  initial_token_scope: {
    permissions: "read-write",
    package_access: "all-packages-bootstrap",
    bypass_2fa: true
  },
  expected_npm_maintainer: "georgiandusk",
  expected_oidc_publisher: "GitHub Actions",
  expected_oidc_trusted_publisher_id: "github",
  expected_provenance_repository: "https://github.com/GeorgianDusk/dusk-developer-studio",
  expected_initial_provenance_workflow: ".github/workflows/studio-npm-publish.yml",
  token_revocation_required: true,
  environment_secret_removal_required: true,
  trusted_publisher_configuration_required: true,
  subsequent_registry_authentication: "github-oidc",
  subsequent_workflow_path: ".github/workflows/studio-npm-oidc-publish.yml",
  required_platforms: ["ubuntu-24.04", "windows-2025", "macos-15"],
  required_package_platforms: ["windows-x64", "ubuntu-24.04-x64", "macos-15-arm64"],
  native_ci_runner_map: {
    "windows-x64": "windows-2025",
    "ubuntu-24.04-x64": "ubuntu-24.04",
    "macos-15-arm64": "macos-15"
  },
  required_package_checks: ["install", "safe", "local-actions", "create-duskds", "shutdown", "cleanup"]
});
assert.ok(phase5Policy.key_source_urls.every((url) => !/dusk-evm|duskevm/i.test(url)));
assert.ok(phase5Policy.key_source_urls.includes("https://docs.dusk.network/developer/smart-contracts-duskds/"));
assert.ok(!phase5Policy.key_source_urls.some((url) => url.includes("/developer/duskvm/quickstart")));
for (const sourceBackedFile of [
  "data/dusk/capabilities.json",
  "data/dusk/resources.json",
  "data/dusk/source-freshness.json",
  "data/dusk/troubleshooting.json",
  "apps/studio/src/app/DuskDsDeployReadiness.tsx",
  "apps/studio/src/app/routes/SystemRoutes.tsx"
]) {
  assert.doesNotMatch(read(sourceBackedFile), /\/developer\/duskvm\/quickstart/, `${sourceBackedFile} must not restore the retired DuskDS guide.`);
}
assert.match(read("data/dusk/resources.json"), /canonical starting point[\s\S]*Make-based build flow/);
assert.match(read("data/dusk/troubleshooting.json"), /different project shape[\s\S]*not interchangeable/);
assert.doesNotMatch(stagingSmoke, /eth_chainId|checkRpc\(/, "DuskEVM RPC must not be requested while its policy check is deferred.");
assert.match(stagingSmoke, /checks\.rpc_chain_id = deferredRpcChainId\(options\.policy\)/);
assert.match(stagingSmoke, /record\("duskds_node_read", \(\) => checkDuskDsNodeRead/);
assert.ok(phase5Policy.required_synthetic_checks.includes("monitor_heartbeat"));
assert.ok(!phase5Policy.required_synthetic_checks.includes("external_dead_man"));
assert.ok(!phase5Policy.required_synthetic_checks.includes("external_direct_health"));
assert.equal(phase5Policy.monitoring_evidence.mode, "github-only");
assert.equal(phase5Policy.monitoring_evidence.accepted_risk.owner, "George");
assert.equal(phase5Policy.monitoring_evidence.accepted_risk.authority_reference, "docs/operations/public-monitoring.md");
assert.ok(phase5Policy.monitoring_evidence.accepted_risk.revisit_triggers.length >= 2);
const phase5Template = JSON.parse(read("config/phase5-evidence.template.json"));
assert.equal(phase5Template.schema_version, 10);
assert.equal(Object.hasOwn(phase5Template, "companion_distribution"), false);
assert.equal(phase5Template.pilot.evidence_class, phase5Policy.pilot.evidence_class);
assert.equal(phase5Template.pilot.operator_type, phase5Policy.pilot.operator_type);
assert.equal(phase5Template.pilot.operator_identity, phase5Policy.pilot.operator_identity);
assert.equal(
  phase5Template.pilot.confidence_score_semantics,
  phase5Policy.pilot.confidence_score_semantics
);
assert.equal(phase5Template.pilot.fixed_limitation, phase5Policy.pilot.fixed_limitation);
assert.match(phase5Template.pilot.fixed_limitation, /do not prove external-human comprehension[\s\S]*adoption/iu);
assert.equal(phase5Template.pilot.receipt_assurance, phase5Policy.pilot.receipt_assurance);
assert.match(phase5Template.pilot.fixed_limitation, /do not independently prove execution/iu);
assert.equal(phase5Template.support.on_call_owner, phase5Policy.responsibility_model.human_owner);
assert.equal(phase5Template.support.launch_message_owner, phase5Policy.responsibility_model.human_owner);
assert.equal(phase5Template.support.incident_message_owner, phase5Policy.responsibility_model.human_owner);
assert.match(phase5Evaluator, /schema_version !== 10/);
assert.match(phase5Evaluator, /agent_operated_simulations/);
assert.match(phase5Evaluator, /human_attestations: \["product_signoff"\]/);
assert.match(phase5Evaluator, /agent_attestations: \["separate_agent_challenge_reviews", "support_assignments", "rollback_execution"\]/);
assert.doesNotMatch(phase5Evaluator, /trusted_human_attestations:/);
assert.match(phase5Evaluator, /parseBoundReceipt\([\s\S]*Pilot session/);
assert.match(phase5Evaluator, /package_inventory_sha256/);
assert.match(phase5Evaluator, /environment_identity/);
assert.match(phase5Evaluator, /raw_observation_bundle_sha256/);
assert.match(phase5Evaluator, /operator-attested-machine-collected/);
assert.match(phase5Evaluator, /final-package-assurance/);
assert.match(phase5Evaluator, /github-actions-upload-artifact-v7/);
assert.match(phase5Evaluator, /evidence_payload_sha256/);
assert.match(phase5Evaluator, /prepublication_cross_run_byte_match/);
assert.match(phase5Evaluator, /main_assurance_artifact_digest_sha256/);
assert.match(phase5Evaluator, /\["push"\][\s\S]*studio-npm-assurance-receipt/);
assert.equal(phase5Template.npm_distribution.package_name, phase5Policy.npm_distribution.package_name);
assert.equal(phase5Template.npm_distribution.package_version, phase5Policy.npm_distribution.package_version);
assert.equal(phase5Template.npm_distribution.node_engine, phase5Policy.npm_distribution.node_engine);
assert.equal(phase5Template.npm_distribution.registry_url, phase5Policy.npm_distribution.registry_url);
assert.ok(Object.hasOwn(phase5Template.npm_distribution, "package_sha256"));
assert.ok(Object.hasOwn(phase5Template.npm_distribution, "package_file_count"));
assert.deepEqual(Object.keys(phase5Template.npm_distribution.platform_smoke), phase5Policy.npm_distribution.required_platforms);
for (const platform of phase5Policy.npm_distribution.required_platforms) {
  const smoke = phase5Template.npm_distribution.platform_smoke[platform];
  assert.equal(smoke.schema_version, 2);
  assert.equal(smoke.runner, platform);
  assert.equal(smoke.node_version, "24.18.0");
  assert.ok(Object.hasOwn(smoke, "integrity"));
  assert.ok(Object.hasOwn(smoke, "package_inventory_sha256"));
  assert.ok(Object.hasOwn(smoke, "package_file_count"));
  assert.ok(Object.hasOwn(smoke, "elevated_refusal"));
  for (const field of [
    "install_smoke",
    "safe_smoke",
    "local_actions_capability_contract_smoke",
    "direct_cli_scaffold_smoke",
    "local_actions_scaffold_smoke",
    "scaffold_preservation_smoke",
    "shutdown_smoke",
    "cleanup_smoke",
    "elevated_refusal"
  ]) assert.equal(smoke[field], "pending");
  assert.equal(smoke.local_actions_preflight_verified, false);
  assert.equal(smoke.local_actions_preflight_loopback_services_stopped, false);
  assert.ok(Object.hasOwn(smoke, "local_actions_preflight_check_id"));
  assert.ok(Object.hasOwn(smoke, "local_actions_preflight_consumer_contract_source_sha256"));
}
assert.equal(phase5Template.npm_distribution.assurance.workflow_path, phase5Policy.npm_distribution.assurance_workflow);
assert.equal(phase5Template.npm_distribution.assurance.provenance.run_event, "push");
for (const field of [
  "exact_tarball_direct_cli_scaffold_smoke",
  "exact_tarball_local_actions_scaffold_smoke",
  "exact_tarball_scaffold_preservation_smoke",
  "exact_tarball_shutdown_smoke"
]) {
  assert.equal(Object.hasOwn(phase5Template.npm_distribution.assurance, field), false);
}
assert.equal(
  Object.hasOwn(phase5Template.npm_distribution.assurance, "browser_boot_and_pairing_smoke"),
  false,
  "Exact-tarball browser proof belongs inside the downloaded assurance receipt_json, not the wrapper."
);
assert.equal(phase5Template.npm_distribution.publication.workflow_path, phase5Policy.npm_distribution.publication_workflow);
assert.equal(
  phase5Template.npm_distribution.bootstrap_controls.package_version,
  phase5Policy.npm_distribution.initial_package_version
);
assert.equal(
  phase5Template.npm_distribution.bootstrap_controls.tag,
  phase5Policy.npm_distribution.initial_tag
);
assert.equal(
  phase5Template.npm_distribution.bootstrap_controls.workflow_path,
  phase5Policy.npm_distribution.expected_initial_provenance_workflow
);
assert.equal(
  phase5Template.npm_distribution.bootstrap_controls.environment,
  phase5Policy.npm_distribution.initial_publication_environment
);
const initialPublicationTemplate =
  phase5Template.npm_distribution.bootstrap_controls.initial_publication;
assert.equal(
  initialPublicationTemplate.candidate_commit,
  initialPublicationEvidence.candidate_commit
);
assert.equal(
  initialPublicationTemplate.receipt_sha256,
  initialPublicationEvidence.receipt_sha256
);
assert.equal(
  initialPublicationTemplate.run_url,
  `https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/${initialPublicationEvidence.run_id}`
);
assert.equal(
  initialPublicationTemplate.artifact_name,
  initialPublicationEvidence.artifact_name
);
assert.equal(
  initialPublicationTemplate.provenance.artifact_id,
  initialPublicationEvidence.artifact_id
);
assert.equal(
  initialPublicationTemplate.provenance.artifact_digest_sha256,
  initialPublicationEvidence.receipt_sha256
);
for (const receipt of [
  phase5Template.npm_distribution.assurance,
  phase5Template.npm_distribution.publication,
  initialPublicationTemplate
]) {
  assert.ok(Object.hasOwn(receipt, "receipt_sha256"));
  assert.ok(Object.hasOwn(receipt, "receipt_json"));
  assert.ok(Object.hasOwn(receipt, "provenance"));
}
assert.equal(phase5Template.npm_distribution.bootstrap_controls.token_revoked, false);
assert.equal(phase5Template.npm_distribution.bootstrap_controls.environment_secret_removed, false);
assert.equal(phase5Template.npm_distribution.bootstrap_controls.trusted_publisher_configured, false);
assert.ok(Object.hasOwn(phase5Template.npm_distribution.bootstrap_controls, "token_revocation_evidence_sha256"));
assert.ok(Object.hasOwn(phase5Template.npm_distribution.bootstrap_controls, "environment_secret_removal_evidence_sha256"));
assert.ok(Object.hasOwn(phase5Template.npm_distribution.bootstrap_controls, "trusted_publisher_evidence_sha256"));
assert.ok(Array.isArray(phase5Template.candidate.implementation_identities));
assert.ok(Object.hasOwn(phase5Template.candidate, "release_id"));
assert.ok(Object.hasOwn(phase5Template.candidate, "policy_sha256"));
assert.ok(Object.hasOwn(phase5Template.candidate, "evaluator_commit"));
assert.equal(phase5Template.synthetics.checks.rpc_chain_id.status, "deferred");
assert.equal(phase5Template.synthetics.checks.rpc_chain_id.reason, phase5Policy.deferred_synthetic_checks.rpc_chain_id.reason);
assert.ok(!Object.hasOwn(phase5Template.live_smoke, "evm_steps"));
assert.deepEqual(Object.keys(phase5Template.live_smoke.native_steps), phase5Policy.required_native_smoke_steps);
assert.equal(phase5Template.live_smoke.workflow_path, ".github/workflows/duskds-native-smoke.yml");
assert.ok(Object.hasOwn(phase5Template.live_smoke, "candidate_commit"));
assert.ok(Object.hasOwn(phase5Template.live_smoke, "candidate_artifact_fingerprint_sha256"));
assert.ok(Object.hasOwn(phase5Template.live_smoke, "receipt_json"));
assert.ok(Object.hasOwn(phase5Template.live_smoke, "provenance"));
assert.equal(phase5Template.synthetics.monitoring.mode, "github-only");
assert.equal(phase5Template.synthetics.monitoring.owner, "George");
assert.equal(phase5Template.synthetics.public_assurance.workflow_path, ".github/workflows/studio-public-staging.yml");
assert.ok(Object.hasOwn(phase5Template.synthetics.public_assurance, "receipt_json"));
assert.ok(Object.hasOwn(phase5Template.synthetics.public_assurance, "provenance"));
for (const requiredCheck of phase5Policy.required_synthetic_checks) {
  assert.ok(Object.hasOwn(phase5Template.synthetics.checks, requiredCheck), `Phase 5 template is missing synthetic check ${requiredCheck}.`);
  assert.ok(Object.hasOwn(phase5Template.synthetics.checks[requiredCheck], "candidate_commit"));
  assert.ok(Object.hasOwn(phase5Template.synthetics.checks[requiredCheck], "candidate_public_fingerprint_sha256"));
}
assert.ok(!Object.hasOwn(phase5Template.synthetics, "alert_delivery_verified"));
assert.equal(phase5Template.synthetics.alert_delivery.workflow_path, ".github/workflows/studio-public-staging.yml");
assert.ok(Object.hasOwn(phase5Template.synthetics.alert_delivery, "receipt_json"));
assert.ok(Object.hasOwn(phase5Template.synthetics.alert_delivery, "provenance"));
assert.ok(Object.hasOwn(phase5Template.synthetics.checks.monitor_heartbeat, "receipt_json"));
assert.ok(Object.hasOwn(phase5Template.synthetics.checks.monitor_heartbeat, "provenance"));
for (const reviewName of phase5Policy.required_reviews) {
  assert.equal(phase5Template.reviews[reviewName].reviewer_type, phase5Policy.responsibility_model.reviewer_type);
  assert.equal(phase5Template.reviews[reviewName].separate_agent, true);
  assert.equal(phase5Template.reviews[reviewName].external_independent, false);
  assert.ok(Object.hasOwn(phase5Template.reviews[reviewName], "reviewer_identity"));
  assert.ok(Object.hasOwn(phase5Template.reviews[reviewName], "candidate_commit"));
  assert.ok(Object.hasOwn(phase5Template.reviews[reviewName], "candidate_artifact_fingerprint_sha256"));
}
for (const rollbackKind of ["product", "platform"]) {
  assert.ok(Object.hasOwn(phase5Template.rollback[rollbackKind], "candidate_commit"));
  assert.ok(Object.hasOwn(phase5Template.rollback[rollbackKind], "candidate_artifact_fingerprint_sha256"));
  assert.ok(Object.hasOwn(phase5Template.rollback[rollbackKind], "evidence_reference"));
  assert.ok(Object.hasOwn(phase5Template.rollback[rollbackKind], "receipt_sha256"));
  assert.ok(Object.hasOwn(phase5Template.rollback[rollbackKind], "receipt_json"));
  assert.equal(phase5Template.rollback[rollbackKind].target, rollbackKind);
}
assert.ok(!Object.hasOwn(phase5Template.synthetics.checks, "external_dead_man"));
assert.ok(!Object.hasOwn(phase5Template.synthetics.checks, "external_direct_health"));
assert.match(read("docs/operations/public-monitoring.md"), /https:\/\/studio\.134-122-59-217\.nip\.io/);
assert.match(read("docs/operations/public-monitoring.md"), /`\/healthz`/);
assert.doesNotMatch(read("docs/operations/public-monitoring.md"), /https:\/\/<project-domain>\/healthz/);

const caddy = read("deploy/caddy/studio.caddy");
assert.match(caddy, /^studio\.134-122-59-217\.nip\.io, studio\.134-122-59-217\.sslip\.io \{/m);
assert.doesNotMatch(caddy, /reverse_proxy|127\.0\.0\.1|localhost|8788|basic_auth|basicauth|\/login/i);
for (const required of ["Content-Security-Policy", "Strict-Transport-Security", "@health path /healthz", "file_server", "dusk-studio-access.log", "roll_keep_for 168h", "request>uri regexp \\?.*$ \"\"", "request>headers>Referer delete"]) {
  assert.ok(caddy.includes(required), `Caddy fragment is missing ${required}.`);
}

const runtime = read("apps/studio/src/app/runtime.ts");
assert.match(runtime, /channel === "npm" && LOOPBACK_HOSTS/);
const systemRoutes = read("apps/studio/src/app/routes/SystemRoutes.tsx");
assert.doesNotMatch(systemRoutes, /Pairing token|Set-Clipboard|DUSK_STUDIO_PAIRING_TOKEN/);
assert.match(systemRoutes, /packageSpecifier = `dusk-developer-studio@\$\{release\.version\}`/);
assert.match(systemRoutes, /safeCommand = `npx \$\{packageSpecifier\}`/);
assert.match(systemRoutes, /localActionsCommand = `\$\{safeCommand\} local-actions`/);
assert.match(systemRoutes, /127\.0\.0\.1:5173[\s\S]*127\.0\.0\.1:8788/);

const forbidden = /dusk-network\/marketing|studio\.dusk\.network|Dusk-controlled|Dusk Foundation|not affiliated|not an official Dusk|UNLICENSED|docs\/planning/i;
const ignored = new Set(["node_modules", ".git", "output", "dist", "coverage", "playwright-report", "test-results"]);
const textExtensions = new Set([".cjs", ".cmd", ".css", ".html", ".js", ".json", ".md", ".mjs", ".ps1", ".sol", ".toml", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExtensions.has(path.extname(entry.name).toLowerCase()) || ["LICENSE", "NOTICE", "Dockerfile"].includes(entry.name)) {
      const relative = path.relative(root, full).replaceAll("\\", "/");
      if (relative === "scripts/test-public-repository.mjs") continue;
      assert.doesNotMatch(fs.readFileSync(full, "utf8"), forbidden, `Private or official identity leaked into ${relative}.`);
    }
  }
}
walk(root);

assert.match(policy.publication.expected_npm_maintainer, /^[a-z0-9][a-z0-9._-]{0,63}$/u);
assert.equal(policy.publication.expected_oidc_publisher, "GitHub Actions");
assert.equal(policy.publication.expected_oidc_trusted_publisher_id, "github");
assert.doesNotMatch(
  policy.publication.expected_npm_maintainer,
  /^(?:replace|pending|todo)/iu,
  "Replace the npm maintainer placeholder with George's confirmed npm username before release."
);

console.log("Public npm repository contract passed.");
