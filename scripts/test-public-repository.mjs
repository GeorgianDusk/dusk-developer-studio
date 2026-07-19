import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

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
  "docs/operations/public-monitoring.md",
  "scripts/phase5-candidate-context.mjs",
  "scripts/verify-npm-provenance.mjs",
  "config/companion-release-policy.json",
  "SUPPORT.md"
]) assert.ok(fs.existsSync(path.join(root, file)), `Missing public repository contract: ${file}`);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.private, true, "The workspace must remain protected from accidental npm publication.");
assert.equal(packageJson.license, "Apache-2.0");
assert.equal(packageJson.repository.url, "git+https://github.com/GeorgianDusk/dusk-developer-studio.git");
assert.match(read("LICENSE"), /Apache License[\s\S]*Version 2\.0/);
assert.doesNotMatch(read("README.md"), /private: true|Project status/);
assert.match(read("SECURITY.md"), /private vulnerability reporting/i);
assert.doesNotMatch(read("README.md"), /`[^`]+` \? /, "README repository map contains a lossy text-export separator.");

const policy = JSON.parse(read("config/companion-release-policy.json"));
assert.equal(policy.schema_version, 2);
assert.equal(policy.distribution, "npm");
assert.deepEqual(policy.package, {
  name: "dusk-developer-studio",
  version: "1.0.0",
  tag: "v1.0.0",
  registry: "https://registry.npmjs.org",
  access: "public",
  node_engine: ">=24.18.0 <25",
  package_root: "packages/cli",
  tarball_path: "output/npm/dusk-developer-studio-1.0.0.tgz",
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
assert.deepEqual(policy.assurance.required_runners, ["ubuntu-24.04", "windows-2025", "macos-15"]);
assert.ok(policy.assurance.required_checks.includes("local-actions-capability-contract-smoke"));
assert.ok(!policy.assurance.required_checks.includes("local-actions-functional-smoke"));
assert.equal(policy.publication.initial_registry_authentication, "short-lived-granular-token");
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
assert.match(elevatedArchiveStep, /output\/npm\/dusk-developer-studio-1\.0\.0\.tgz/);
assert.match(elevatedArchiveStep, /node_modules\/dusk-developer-studio\/bin\/dusk-developer-studio\.mjs/);
assert.match(elevatedArchiveStep, /@(?:\(|\{)'--lifecycle-self-test', '--no-open'(?:\)|\})/);
assert.match(elevatedArchiveStep, /@(?:\(|\{)'local-actions', '--lifecycle-self-test', '--no-open'(?:\)|\})/);

const npmAssuranceWorkflow = read(".github/workflows/studio-npm-package-assurance.yml");
assert.match(npmAssuranceWorkflow, /runner: \[ubuntu-24\.04, windows-2025, macos-15\]/);
assert.match(npmAssuranceWorkflow, /pnpm build:npm[\s\S]*pnpm test:npm[\s\S]*node scripts\/npm-package-pack\.mjs/);
assert.doesNotMatch(npmAssuranceWorkflow, /^\s+paths:/m);
assert.match(npmAssuranceWorkflow, /CANDIDATE_ARTIFACT: dusk-developer-studio-1\.0\.0\.tgz[\s\S]*name: Build the exact npm candidate once[\s\S]*name: \$\{\{ env\.CANDIDATE_ARTIFACT \}\}[\s\S]*archive: false/);
assert.match(npmAssuranceWorkflow, /needs: build-package[\s\S]*name: \$\{\{ env\.CANDIDATE_ARTIFACT \}\}[\s\S]*path: output\/npm/);
assert.match(npmAssuranceWorkflow, /^ {4}name: Aggregate npm package assurance$/m);
assert.match(npmAssuranceWorkflow, /native|exe\|dll\|dylib\|so\|node/i);
assert.match(npmAssuranceWorkflow, /npm install --ignore-scripts/);
assert.match(npmAssuranceWorkflow, /--lifecycle-self-test --no-open/);
assert.match(npmAssuranceWorkflow, /local-actions --lifecycle-self-test --no-open/);
assert.match(npmAssuranceWorkflow, /fs\.mkdtempSync[\s\S]*unpackedBytes \+= stats\.size[\s\S]*maximum_unpacked_bytes/);
assert.match(npmAssuranceWorkflow, /New-LocalUser[\s\S]*Start-Process[\s\S]*-Credential \$credential[\s\S]*Invoke-StandardUserSmoke -Arguments @\('--lifecycle-self-test', '--no-open'\)[\s\S]*Invoke-StandardUserSmoke -Arguments @\('local-actions', '--lifecycle-self-test', '--no-open'\)/);
assert.match(npmAssuranceWorkflow, /NPM_SAFE_SMOKE=passed[\s\S]*NPM_LOCAL_ACTIONS_CAPABILITY_CONTRACT_SMOKE=passed[\s\S]*NPM_ELEVATED_REFUSAL=passed[\s\S]*Platform receipt cannot be written before all lifecycle smokes execute successfully/);
assert.match(npmAssuranceWorkflow, /EXPECTED_BROWSER_SMOKE !== "passed"[\s\S]*browser_boot_and_pairing_smoke: "passed"/);
assert.match(npmAssuranceWorkflow, /name: npm-platform-\$\{\{ matrix\.runner \}\}[\s\S]*path: output\/npm\/platform\/npm-platform-\$\{\{ matrix\.runner \}\}\.json/);
assert.match(npmAssuranceWorkflow, /name: studio-npm-assurance-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*path: output\/npm\/studio-npm-assurance-receipt-\$\{\{ github\.run_id \}\}\.json[\s\S]*archive: false/);
assert.match(elevatedArchiveStep, /New-LocalUser[\s\S]*Start-Process[\s\S]*-Credential \$credential/);
for (const workflow of [requiredWindowsWorkflow, npmAssuranceWorkflow]) {
  assert.match(workflow, /NODE_BIN="\$\(command -v node\)"[\s\S]*sudo -n "\$NODE_BIN" "\$PRIMARY"/);
  assert.doesNotMatch(workflow, /sudo -n node /);
  assert.match(workflow, /\$dataRoot = Join-Path \$env:PUBLIC[\s\S]*"\*\$\{userSid\}:\(OI\)\(CI\)M"/);
  assert.match(workflow, /\$childEnvironment = @\{[\s\S]*HOME = \$profileRoot[\s\S]*LOCALAPPDATA = \$localAppData[\s\S]*USERPROFILE = \$profileRoot[\s\S]*-Environment \$childEnvironment/);
  assert.match(workflow, /Test-Path -LiteralPath \$dataRoot[\s\S]*Remove-Item -LiteralPath \$dataRoot -Recurse -Force/);
}

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
assert.match(npmOidcWorkflow, /id-token: write/);
assert.match(npmOidcWorkflow, /environment: npm-trusted-publication/);
assert.match(npmOidcWorkflow, /registry-url: https:\/\/registry\.npmjs\.org/);
assert.match(npmOidcWorkflow, /test -z "\$\{NODE_AUTH_TOKEN:-\}"[\s\S]*npm publish "\$TARBALL" --access public --provenance/);
assert.match(npmOidcWorkflow, /npm install --ignore-scripts --no-audit --no-fund --save-exact --registry=https:\/\/registry\.npmjs\.org "dusk-developer-studio@\$PACKAGE_VERSION"[\s\S]*package-lock\.json[\s\S]*node_modules\/dusk-developer-studio[\s\S]*process\.env\.GITHUB_REF_NAME\.slice\(1\)[\s\S]*record\.integrity !== process\.env\.LOCAL_NPM_INTEGRITY[\s\S]*npm audit signatures/);
assert.doesNotMatch(npmOidcWorkflow, /--package-lock-only/);
assert.match(npmOidcWorkflow, /npm audit signatures --registry=https:\/\/registry\.npmjs\.org/);
assert.match(npmOidcWorkflow, /verify-npm-provenance\.mjs[\s\S]*--publication=subsequent/);
assert.match(npmOidcWorkflow, /publisher\?\.name !== policy\.publication\.expected_oidc_publisher[\s\S]*publisher\?\.trustedPublisher\?\.id !== policy\.publication\.expected_oidc_trusted_publisher_id/);
assert.match(npmOidcWorkflow, /record\.replace\(\/\\s\+<\[\^>\]\+>\$\/u, ""\)\.trim\(\)[\s\S]*npmPublisher !== policy\.publication\.expected_oidc_publisher/);
assert.match(npmOidcWorkflow, /registryPublisher\?\.name !== policy\.publication\.expected_oidc_publisher[\s\S]*registryPublisher\?\.trustedPublisher\?\.id !== policy\.publication\.expected_oidc_trusted_publisher_id/);
assert.doesNotMatch(npmOidcWorkflow, /npmUser !== policy\.publication\.expected_npm_maintainer/);
assert.doesNotMatch(npmOidcWorkflow, /secrets\.|NPM_INITIAL_PUBLISH_TOKEN/);
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
assert.equal(duskDsToolchainPolicy.schema_version, 1);
assert.equal(duskDsToolchainPolicy.rust_toolchain, "1.94.0");
assert.deepEqual(duskDsToolchainPolicy.dusk_forge, {
  repository: "https://github.com/dusk-network/forge",
  package: "dusk-forge-cli",
  binary: "dusk-forge",
  revision: "d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a"
});
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
assert.match(duskDsNativeSmokeWorkflow, /`RUSK_TAG=\$\{policy\.rusk\.tag\}`/);
assert.match(duskDsNativeSmokeWorkflow, /`RUSK_COMMIT=\$\{policy\.rusk\.revision\}`/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /FORGE_COMMIT:\s*[0-9a-f]{40}/);
assert.match(duskDsNativeSmokeWorkflow, /grep -Fq "\$FORGE_COMMIT" "\$RUNNER_TEMP\/dusk-forge\/\.crates2\.json"/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge new duskds-phase5-smoke/);
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
assert.match(publicReleaseSpec, /expect\(page\.url\(\), pathname\)\.toBe\(expected\.href\)/);
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
    "Install the pinned Rust and Dusk Forge toolchain",
    "Verify required native tools",
    "Scaffold through the pinned Forge release",
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
const phase5ProvenanceVerifier = read("scripts/github-actions-provenance.mjs");
assert.match(phase5Checker, /GH_TOKEN[\s\S]*GITHUB_TOKEN[\s\S]*evaluatePhase5EvidenceOnline/);
assert.match(phase5Checker, /verifyCandidateBoundPhase5Context[\s\S]*policyBytes[\s\S]*candidateContext/);
assert.match(phase5CandidateContext, /rev-parse[\s\S]*status[\s\S]*--untracked-files=no[\s\S]*cat-file/);
assert.match(phase5ProvenanceVerifier, /run_attempt !== 1/);
assert.match(phase5ProvenanceVerifier, /redirect: "manual"[\s\S]*redirect: "error"/);
assert.match(phase5ProvenanceVerifier, /does not have exactly one run-scoped receipt artifact/);
assert.match(read("package.json"), /scripts\/test-github-actions-provenance\.mjs/);
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
assert.deepEqual(phase5Policy.pilot, {
  minimum_total: 8,
  minimum_duskds: 8,
  required_experience: ["novice", "experienced"],
  required_contexts: ["windows", "wsl", "linux", "macos"],
  minimum_completion_rate: 0.83,
  minimum_recovery_rate: 0.8,
  minimum_average_trust_score: 4,
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
  package_version: "1.0.0",
  tag: "v1.0.0",
  registry_url: "https://registry.npmjs.org/dusk-developer-studio",
  node_engine: ">=24.18.0 <25",
  assurance_workflow: ".github/workflows/studio-npm-package-assurance.yml",
  publication_workflow: ".github/workflows/studio-npm-publish.yml",
  initial_publication_environment: "npm-initial-publication",
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
  required_platforms: ["ubuntu-24.04", "windows-2025", "macos-15"]
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
const stagingSmoke = read("scripts/staging-smoke.mjs");
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
assert.equal(phase5Template.schema_version, 5);
assert.equal(Object.hasOwn(phase5Template, "companion_distribution"), false);
assert.equal(phase5Template.npm_distribution.package_name, phase5Policy.npm_distribution.package_name);
assert.equal(phase5Template.npm_distribution.package_version, phase5Policy.npm_distribution.package_version);
assert.equal(phase5Template.npm_distribution.node_engine, phase5Policy.npm_distribution.node_engine);
assert.equal(phase5Template.npm_distribution.registry_url, phase5Policy.npm_distribution.registry_url);
assert.deepEqual(Object.keys(phase5Template.npm_distribution.platform_smoke), phase5Policy.npm_distribution.required_platforms);
for (const platform of phase5Policy.npm_distribution.required_platforms) {
  const smoke = phase5Template.npm_distribution.platform_smoke[platform];
  assert.equal(smoke.runner, platform);
  assert.equal(smoke.node_version, "24.18.0");
  assert.ok(Object.hasOwn(smoke, "integrity"));
  assert.ok(Object.hasOwn(smoke, "package_inventory_sha256"));
  assert.ok(Object.hasOwn(smoke, "elevated_refusal"));
}
assert.equal(phase5Template.npm_distribution.assurance.workflow_path, phase5Policy.npm_distribution.assurance_workflow);
assert.equal(
  Object.hasOwn(phase5Template.npm_distribution.assurance, "browser_boot_and_pairing_smoke"),
  false,
  "Exact-tarball browser proof belongs inside the downloaded assurance receipt_json, not the wrapper."
);
assert.equal(phase5Template.npm_distribution.publication.workflow_path, phase5Policy.npm_distribution.publication_workflow);
for (const receipt of [phase5Template.npm_distribution.assurance, phase5Template.npm_distribution.publication]) {
  assert.ok(Object.hasOwn(receipt, "receipt_sha256"));
  assert.ok(Object.hasOwn(receipt, "receipt_json"));
  assert.ok(Object.hasOwn(receipt, "provenance"));
}
assert.equal(phase5Template.npm_distribution.post_publication_controls.token_revoked, false);
assert.equal(phase5Template.npm_distribution.post_publication_controls.environment_secret_removed, false);
assert.equal(phase5Template.npm_distribution.post_publication_controls.trusted_publisher_configured, false);
assert.ok(Object.hasOwn(phase5Template.npm_distribution.post_publication_controls, "token_revocation_evidence_sha256"));
assert.ok(Object.hasOwn(phase5Template.npm_distribution.post_publication_controls, "environment_secret_removal_evidence_sha256"));
assert.ok(Object.hasOwn(phase5Template.npm_distribution.post_publication_controls, "trusted_publisher_evidence_sha256"));
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
  assert.equal(phase5Template.reviews[reviewName].independent, false);
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
assert.match(systemRoutes, /npx dusk-developer-studio[\s\S]*npx dusk-developer-studio local-actions/);
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
