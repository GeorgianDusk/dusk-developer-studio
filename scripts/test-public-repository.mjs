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
  ".github/workflows/studio-companion-signed-rc.yml",
  ".github/workflows/studio-public-staging.yml",
  ".github/workflows/studio-monitor-schedule-guard.yml",
  ".github/workflows/duskds-native-smoke.yml",
  "docs/operations/public-monitoring.md",
  "docs/operations/github-only-monitoring-decision.md",
  "docs/deployment/project-domain-migration.md"
]) assert.ok(fs.existsSync(path.join(root, file)), `Missing public repository contract: ${file}`);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.private, true, "The workspace must remain protected from accidental npm publication.");
assert.equal(packageJson.license, "Apache-2.0");
assert.equal(packageJson.repository.url, "git+https://github.com/GeorgianDusk/dusk-developer-studio.git");
assert.match(read("LICENSE"), /Apache License[\s\S]*Version 2\.0/);
assert.match(read("README.md"), /Independent open-source project maintained by/);
assert.doesNotMatch(read("README.md"), /private: true|Project status/);
assert.match(read("SECURITY.md"), /private vulnerability reporting/i);
assert.doesNotMatch(read("README.md"), /`[^`]+` \? /, "README repository map contains a lossy text-export separator.");

const policy = JSON.parse(read("config/companion-standalone-signing-policy.json"));
assert.equal(policy.canonical_repository, "GeorgianDusk/dusk-developer-studio");
assert.equal(policy.publication_enabled, false);
assert.deepEqual(policy.candidate_transport, {
  enabled: false,
  provider: "none",
  blocker: "No private signed-candidate transport has been implemented and independently reviewed; candidate binaries must not use GitHub Actions artifacts or draft releases."
});
assert.equal(policy.targets["windows-x64"].approved_identity, "");
assert.equal(policy.targets["darwin-arm64"].approved_identity, "");
assert.match(policy.targets["linux-x64"].identity_template, /GeorgianDusk\/dusk-developer-studio/);

const workflows = [
  ".github/workflows/studio-linux-security.yml",
  ".github/workflows/platform-caddy-security.yml",
  ".github/workflows/studio-companion-signed-rc.yml",
  ".github/workflows/studio-public-staging.yml",
  ".github/workflows/studio-monitor-schedule-guard.yml",
  ".github/workflows/duskds-native-smoke.yml"
].map((file) => [file, read(file)]);
for (const [file, workflow] of workflows) {
  assert.doesNotMatch(workflow, /dusk-network\/marketing|products\/developer-testnet-studio/);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|actions:\s*write/);
  assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?![a-f0-9]{40}(?:\s|$))/m, `${file} contains a mutable action reference.`);
}

const signedWorkflow = read(".github/workflows/studio-companion-signed-rc.yml");
assert.doesNotMatch(signedWorkflow, /^\s+(?:push|pull_request|schedule):/m);
assert.doesNotMatch(signedWorkflow, /gh release|create-release|softprops\/action-gh-release|release-action/i);
assert.doesNotMatch(signedWorkflow, /name:\s*studio-signed-rc-(?:windows-x64|linux-x64|darwin-arm64)/);
for (const step of signedWorkflow.split(/\n(?= {6}- )/)) {
  if (step.includes("uses: actions/upload-artifact@")) assert.match(step, /path:\s*[^\n]*\.json/);
}

const publicStagingWorkflow = read(".github/workflows/studio-public-staging.yml");
assert.match(publicStagingWorkflow, /^name: Studio public deployment assurance$/m);
assert.match(publicStagingWorkflow, /^"on":\n {2}schedule:\n {4}- cron: "23 \*\/6 \* \* \*"\n {2}workflow_dispatch:/m);
assert.doesNotMatch(publicStagingWorkflow, /^ {2}(?:push|pull_request):/m);
assert.match(publicStagingWorkflow, /--commit="\$GITHUB_SHA"/);
assert.match(publicStagingWorkflow, /--rpc-degradation="\$\{\{ steps\.browser\.outcome \}\}"/);
assert.match(publicStagingWorkflow, /issues: write/);
assert.match(publicStagingWorkflow, /gh issue create[\s\S]*--assignee GeorgianDusk/);
assert.match(publicStagingWorkflow, /gh issue close/);
assert.doesNotMatch(publicStagingWorkflow, /STUDIO_MONITOR_HEARTBEAT|EXTERNAL_HEARTBEAT|external_heartbeat|external_failure/);
assert.match(publicStagingWorkflow, /vars\.DUSK_STUDIO_PUBLIC_URL/);
assert.match(publicStagingWorkflow, /vars\.DUSK_STUDIO_PUBLIC_ENVIRONMENT/);
assert.doesNotMatch(publicStagingWorkflow, /default:\s*https:\/\/studio\.134-122-59-217\.sslip\.io/);
assert.match(publicStagingWorkflow, /expected_environment:[\s\S]*default: repository-default[\s\S]*- repository-default/);
assert.match(publicStagingWorkflow, /case "\$EXPECTED_ENVIRONMENT" in staging\|production/);
assert.match(publicStagingWorkflow, /validateAssuranceTargetOrigin\(process\.env\.TARGET_URL, policy\)/);
assert.ok(publicStagingWorkflow.indexOf("validateAssuranceTargetOrigin(process.env.TARGET_URL, policy)") < publicStagingWorkflow.indexOf("run: pnpm e2e:public"), "Target policy must be validated before Playwright makes network requests.");
assert.match(publicStagingWorkflow, /Studio upstream dependency unavailable/);
assert.match(publicStagingWorkflow, /steps\.classification\.outputs\.studio_status/);
assert.match(publicStagingWorkflow, /selectAssuranceIncidentTitle/);
assert.match(publicStagingWorkflow, /selectAssuranceIncidentTitle\(process\.env\.BROWSER_OUTCOME, process\.env\.SYNTHETIC_OUTCOME, classification\)/);
assert.doesNotMatch(publicStagingWorkflow, /selectScheduledHeartbeatSignal|heartbeat_signal/);
assert.match(publicStagingWorkflow, /Monitoring mode: GitHub-only under docs\/operations\/github-only-monitoring-decision\.md/);
assert.match(publicStagingWorkflow, /for other_title in "Studio public deployment assurance failed" "Studio upstream dependency unavailable"/);
assert.match(publicStagingWorkflow, /Reclassified into #\$issue by failed scheduled assurance/);
assert.ok(publicStagingWorkflow.indexOf('issue_url="$(gh issue create') < publicStagingWorkflow.indexOf('for other_title in "Studio public deployment assurance failed"'), "The selected incident must be open before other component titles are reclassified.");
const duskDsNativeSmokeWorkflow = read(".github/workflows/duskds-native-smoke.yml");
assert.match(duskDsNativeSmokeWorkflow, /^name: DuskDS native production smoke$/m);
assert.match(duskDsNativeSmokeWorkflow, /runs-on: ubuntu-24\.04/);
assert.match(duskDsNativeSmokeWorkflow, /persist-credentials: "false"/);
assert.match(duskDsNativeSmokeWorkflow, /EXPECTED_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
assert.match(duskDsNativeSmokeWorkflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}[\s\S]*git rev-parse HEAD\)" = "\$EXPECTED_COMMIT"/);
assert.match(duskDsNativeSmokeWorkflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020[\s\S]*node-version: 24\.11\.0/);
assert.match(duskDsNativeSmokeWorkflow, /RUST_TOOLCHAIN: 1\.94\.0/);
assert.match(duskDsNativeSmokeWorkflow, /FORGE_COMMIT: d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a/);
assert.match(duskDsNativeSmokeWorkflow, /RUSK_COMMIT: ae1a38a2079c681126a96f94c17d282ea2639946/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge new duskds-phase5-smoke/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge check/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge build all/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge test/);
assert.match(duskDsNativeSmokeWorkflow, /dusk-forge verify --skip-build/);
assert.match(duskDsNativeSmokeWorkflow, /scripts\/staging-smoke\.mjs/);
assert.match(duskDsNativeSmokeWorkflow, /checkDuskDsNodeRead\(policy\.duskds_testnet_graphql_url\)/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /curl[\s\S]*DUSKDS_GRAPHQL_URL|\.data\.block\.header|DUSKDS_GRAPHQL_URL/);
assert.ok(duskDsNativeSmokeWorkflow.indexOf("Read the official DuskDS Testnet node") < duskDsNativeSmokeWorkflow.indexOf("Install the pinned Rust and Dusk Forge toolchain"), "The bounded node read must fail fast before the expensive native toolchain install.");
assert.match(duskDsNativeSmokeWorkflow, /git\+https:\/\/github\.com\/dusk-network\/rusk\?tag=dusk-core-1\.6\.0#\$RUSK_COMMIT/);
assert.match(duskDsNativeSmokeWorkflow, /GITHUB_STEP_SUMMARY/);
assert.doesNotMatch(duskDsNativeSmokeWorkflow, /upload-artifact|contents:\s*write|secrets\./);
const publicReleaseSpec = read("tests/e2e/public-release.spec.ts");
assert.match(publicReleaseSpec, /request\.get\(expected\.href, \{ maxRedirects: 0 \}\)/);
assert.match(publicReleaseSpec, /context\.route\("\*\*\/\*"/);
assert.match(publicReleaseSpec, /route\.abort\("blockedbyclient"\)/);
assert.match(publicReleaseSpec, /requestUrl\.origin !== publicOrigin/);
assert.match(publicReleaseSpec, /rpc\.testnet\.evm\.dusk\.network/);
assert.match(publicReleaseSpec, /redirectedFrom\(\)/);
assert.match(publicReleaseSpec, /expect\(page\.url\(\), pathname\)\.toBe\(expected\.href\)/);
const publicMonitoring = read("docs/operations/public-monitoring.md");
assert.match(publicMonitoring, /monitoring_evidence\.mode=github-only/);
assert.match(publicMonitoring, /does not call a third-party heartbeat/);
assert.doesNotMatch(publicMonitoring, /STUDIO_MONITOR_HEARTBEAT/);
const monitoringDecision = read("docs/operations/github-only-monitoring-decision.md");
assert.match(monitoringDecision, /Status: accepted/);
assert.match(monitoringDecision, /Owner: George/);
assert.match(monitoringDecision, /GitHub-wide Actions or Issues outage/);
assert.match(monitoringDecision, /Revisit triggers/);
const domainMigration = read("docs/deployment/project-domain-migration.md");
assert.match(domainMigration, /current origin approved for production/);
assert.match(domainMigration, /optional future migration, not a current launch\s+blocker/);
assert.match(domainMigration, /client-side resolver or\s+endpoint-security interception, not an invalid certificate/);
assert.match(domainMigration, /Never add a browser, antivirus, or TLS exception/);
assert.match(domainMigration, /Stage 1: prepare source and the exact candidate/);
assert.match(domainMigration, /Stage 4: activate scheduled GitHub monitoring/);
const caddyDryRunIndex = domainMigration.indexOf("non-mutating dry run of candidate configuration **B**");
const caddyDrillIndex = domainMigration.indexOf('Before the real deployment, run `-RehearseRollback`');
const caddyLiveIndex = domainMigration.indexOf("Only after that rehearsal passes, deploy B once");
assert.ok(caddyDryRunIndex >= 0 && caddyDrillIndex >= 0 && caddyLiveIndex >= 0, "All exact Stage 2 Caddy release-control steps must be documented.");
assert.ok(caddyDryRunIndex < caddyDrillIndex && caddyDrillIndex < caddyLiveIndex, "Caddy dry run and A-to-B-to-A rehearsal must precede the one real B deployment.");
assert.match(domainMigration, /finish with A's release id, hashes, Studio routes, and\s+authenticated Analytics routes reverified/);
assert.ok(domainMigration.indexOf("one real deployment of B") < domainMigration.indexOf("Immediately dispatch public assurance"), "The one real candidate deployment must precede manual assurance.");
assert.match(domainMigration, /new versioned\s+rollback release from the retained exact A artifact/);
assert.match(domainMigration, /-ExpectedCurrentReleaseId '<B-release-id>'/);
assert.match(domainMigration, /project hostname and the\s+current production alias/);
assert.ok(domainMigration.indexOf("Immediately dispatch public assurance") < domainMigration.indexOf("Set `DUSK_STUDIO_PUBLIC_URL=https://<fqdn>`"), "Manual production assurance must precede the scheduled-monitor target cutover.");

const caddyWorkflow = read(".github/workflows/platform-caddy-security.yml");
assert.match(caddyWorkflow, /sudo install -d -m 0755[\s\S]*\/var\/log\/caddy/);
assert.match(caddyWorkflow, /\/tmp\/caddy validate --config "\$fragment" --adapter caddyfile/);

const watchdogWorkflow = read(".github/workflows/studio-monitor-schedule-guard.yml");
assert.match(watchdogWorkflow, /^"on":\n {2}schedule:\n {4}- cron: "47 4,16 \* \* \*"\n {2}workflow_dispatch:/m);
assert.match(watchdogWorkflow, /actions: read/);
assert.match(watchdogWorkflow, /issues: write/);
assert.match(watchdogWorkflow, /node scripts\/monitor-heartbeat\.mjs --max-age-hours=15/);
assert.match(watchdogWorkflow, /gh issue create[\s\S]*--assignee GeorgianDusk/);
assert.match(watchdogWorkflow, /ref: \$\{\{ github\.sha \}\}[\s\S]*git rev-parse HEAD/);

const phase5Policy = JSON.parse(read("config/phase5-policy.json"));
assert.deepEqual(phase5Policy.production_paths, ["duskds"]);
assert.deepEqual(phase5Policy.preview_paths, ["evm"]);
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
assert.ok(phase5Policy.key_source_urls.every((url) => !/dusk-evm|duskevm/i.test(url)));
const stagingSmoke = read("scripts/staging-smoke.mjs");
assert.doesNotMatch(stagingSmoke, /eth_chainId|checkRpc\(/, "DuskEVM RPC must not be requested while its policy check is deferred.");
assert.match(stagingSmoke, /checks\.rpc_chain_id = deferredRpcChainId\(options\.policy\)/);
assert.match(stagingSmoke, /record\("duskds_node_read", \(\) => checkDuskDsNodeRead/);
assert.ok(phase5Policy.required_synthetic_checks.includes("monitor_heartbeat"));
assert.ok(!phase5Policy.required_synthetic_checks.includes("external_dead_man"));
assert.ok(!phase5Policy.required_synthetic_checks.includes("external_direct_health"));
assert.equal(phase5Policy.monitoring_evidence.mode, "github-only");
assert.equal(phase5Policy.monitoring_evidence.accepted_risk.owner, "George");
assert.equal(phase5Policy.monitoring_evidence.accepted_risk.authority_reference, "docs/operations/github-only-monitoring-decision.md");
assert.ok(phase5Policy.monitoring_evidence.accepted_risk.revisit_triggers.length >= 2);
const phase5Template = JSON.parse(read("config/phase5-evidence.template.json"));
assert.equal(phase5Template.schema_version, 2);
assert.equal(phase5Template.synthetics.checks.rpc_chain_id.status, "deferred");
assert.equal(phase5Template.synthetics.checks.rpc_chain_id.reason, phase5Policy.deferred_synthetic_checks.rpc_chain_id.reason);
assert.ok(!Object.hasOwn(phase5Template.live_smoke, "evm_steps"));
assert.deepEqual(Object.keys(phase5Template.live_smoke.native_steps), phase5Policy.required_native_smoke_steps);
assert.equal(phase5Template.synthetics.monitoring.mode, "github-only");
assert.equal(phase5Template.synthetics.monitoring.owner, "George");
assert.ok(!Object.hasOwn(phase5Template.synthetics.checks, "external_dead_man"));
assert.ok(!Object.hasOwn(phase5Template.synthetics.checks, "external_direct_health"));
assert.match(read("docs/operations/public-monitoring.md"), /https:\/\/studio\.134-122-59-217\.sslip\.io\/healthz/);
assert.doesNotMatch(read("docs/operations/public-monitoring.md"), /https:\/\/<project-domain>\/healthz/);

const caddy = read("deploy/caddy/studio.caddy");
assert.doesNotMatch(caddy, /reverse_proxy|127\.0\.0\.1|localhost|8788|basic_auth|basicauth|\/login/i);
for (const required of ["Content-Security-Policy", "Strict-Transport-Security", "@health path /healthz", "file_server", "dusk-studio-access.log", "roll_keep_for 168h", "request>uri regexp \\?.*$ \"\"", "request>headers>Referer delete"]) {
  assert.ok(caddy.includes(required), `Caddy fragment is missing ${required}.`);
}

const runtime = read("apps/studio/src/app/runtime.ts");
assert.match(runtime, /channel === "portable" && LOOPBACK_HOSTS/);
const systemRoutes = read("apps/studio/src/app/routes/SystemRoutes.tsx");
assert.doesNotMatch(systemRoutes, /Pairing token|Set-Clipboard|DUSK_STUDIO_PAIRING_TOKEN/);
assert.match(systemRoutes, /there is no manual token-copy workflow/);

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

console.log("Public standalone repository contract passed.");
