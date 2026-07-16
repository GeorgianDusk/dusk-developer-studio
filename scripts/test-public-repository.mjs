import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const file of [
  "LICENSE", "NOTICE", "DISCLAIMER.md", "SECURITY.md", "CONTRIBUTING.md",
  ".github/CODEOWNERS", ".github/dependabot.yml",
  ".github/workflows/studio-linux-security.yml",
  ".github/workflows/platform-caddy-security.yml",
  ".github/workflows/studio-companion-signed-rc.yml"
]) assert.ok(fs.existsSync(path.join(root, file)), `Missing public repository contract: ${file}`);

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.private, true, "The workspace must remain protected from accidental npm publication.");
assert.equal(packageJson.license, "Apache-2.0");
assert.equal(packageJson.repository.url, "git+https://github.com/GeorgianDusk/dusk-developer-studio.git");
assert.match(read("LICENSE"), /Apache License[\s\S]*Version 2\.0/);
assert.match(read("README.md"), /Independent open-source community project/);
assert.match(read("README.md"), /private: true[\s\S]*prevents accidental npm publication/);
assert.match(read("DISCLAIMER.md"), /not created, maintained, sponsored, endorsed, audited, or distributed by Dusk Network/i);
assert.match(read("SECURITY.md"), /private vulnerability reporting/i);

const policy = JSON.parse(read("config/companion-standalone-signing-policy.json"));
assert.equal(policy.canonical_repository, "GeorgianDusk/dusk-developer-studio");
assert.equal(policy.publication_enabled, false);
assert.equal(policy.targets["windows-x64"].approved_identity, "");
assert.equal(policy.targets["darwin-arm64"].approved_identity, "");
assert.match(policy.targets["linux-x64"].identity_template, /GeorgianDusk\/dusk-developer-studio/);

const workflows = [
  ".github/workflows/studio-linux-security.yml",
  ".github/workflows/platform-caddy-security.yml",
  ".github/workflows/studio-companion-signed-rc.yml"
].map((file) => [file, read(file)]);
for (const [file, workflow] of workflows) {
  assert.doesNotMatch(workflow, /dusk-network\/marketing|products\/developer-testnet-studio/);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|actions:\s*write/);
  assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?![a-f0-9]{40}(?:\s|$))/m, `${file} contains a mutable action reference.`);
}

const signedWorkflow = read(".github/workflows/studio-companion-signed-rc.yml");
assert.doesNotMatch(signedWorkflow, /^\s+(?:push|pull_request|schedule):/m);
assert.doesNotMatch(signedWorkflow, /gh release|create-release|softprops\/action-gh-release|release-action/i);

const caddy = read("deploy/caddy/studio.caddy");
assert.doesNotMatch(caddy, /reverse_proxy|127\.0\.0\.1|localhost|8788|basic_auth|basicauth|\/login/i);
for (const required of ["Content-Security-Policy", "Strict-Transport-Security", "respond /healthz", "file_server"]) {
  assert.ok(caddy.includes(required), `Caddy fragment is missing ${required}.`);
}

const runtime = read("apps/studio/src/app/runtime.ts");
assert.match(runtime, /channel === "portable" && LOOPBACK_HOSTS/);
const systemRoutes = read("apps/studio/src/app/routes/SystemRoutes.tsx");
assert.doesNotMatch(systemRoutes, /Pairing token|Set-Clipboard|DUSK_STUDIO_PAIRING_TOKEN/);
assert.match(systemRoutes, /there is no manual token-copy workflow/);

const forbidden = /dusk-network\/marketing|studio\.dusk\.network|Dusk-controlled|UNLICENSED|docs\/planning/i;
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
