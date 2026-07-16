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
  "docs/operations/public-monitoring.md"
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
  ".github/workflows/studio-monitor-schedule-guard.yml"
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
assert.match(publicStagingWorkflow, /^"on":\n {2}schedule:\n {4}- cron: "23 \*\/6 \* \* \*"\n {2}workflow_dispatch:/m);
assert.doesNotMatch(publicStagingWorkflow, /^ {2}(?:push|pull_request):/m);
assert.match(publicStagingWorkflow, /--commit="\$GITHUB_SHA"/);
assert.match(publicStagingWorkflow, /--rpc-degradation="\$\{\{ steps\.browser\.outcome \}\}"/);
assert.match(publicStagingWorkflow, /issues: write/);
assert.match(publicStagingWorkflow, /gh issue create[\s\S]*--assignee GeorgianDusk/);
assert.match(publicStagingWorkflow, /gh issue close/);
assert.match(publicStagingWorkflow, /secrets\.STUDIO_MONITOR_HEARTBEAT_URL/);
assert.match(publicStagingWorkflow, /curl --proto '=https'[\s\S]*EXTERNAL_HEARTBEAT_URL/);

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
assert.ok(phase5Policy.required_synthetic_checks.includes("monitor_heartbeat"));
assert.ok(phase5Policy.required_synthetic_checks.includes("external_dead_man"));

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
