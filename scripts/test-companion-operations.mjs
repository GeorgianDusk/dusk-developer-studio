import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const files = {
  support: "SUPPORT.md",
  security: "SECURITY.md",
  route: "docs/operations/companion-support-and-incident.md",
  compatibility: "docs/operations/companion-compatibility.md",
  response: "docs/operations/companion-quarantine-and-withdrawal.md",
  recovery: "docs/operations/local-companion-recovery.md"
};

for (const file of Object.values(files)) {
  assert.ok(fs.existsSync(path.join(root, file)), `Missing companion operations contract: ${file}`);
}

const support = read(files.support);
const security = read(files.security);
const route = read(files.route);
const compatibility = read(files.compatibility);
const response = read(files.response);
const recovery = read(files.recovery);
const combined = [support, security, route, compatibility, response, recovery].join("\n");

const bugRoute = "https://github.com/GeorgianDusk/dusk-developer-studio/issues/new?template=bug_report.yml";
const privateSecurityRoute = "https://github.com/GeorgianDusk/dusk-developer-studio/security/advisories/new";
for (const document of [support, route]) assert.ok(document.includes(bugRoute), "Canonical bug-report route is missing.");
for (const document of [support, security, route]) assert.ok(document.includes(privateSecurityRoute), "Canonical private security route is missing.");

assert.match(support, /No public local-companion binary is currently distributed or supported/i);
assert.match(route, /no supported public companion executable/i);
assert.match(route, /seven calendar days \(168 hours\)/i);
assert.match(route, /procedure alone does not satisfy public-release support evidence/i);

for (const target of ["Windows x64", "Linux x64", "macOS arm64"]) {
  assert.match(compatibility, new RegExp(target, "i"), `Compatibility matrix is missing ${target}.`);
}
for (const boundary of [
  /not a download matrix/i,
  /No operating system currently has a\s+supported public companion download/i,
  /Internal fixtures or same-runner checks must not be relabelled/i,
  /exact enumerated\s+workflow-owned candidate paths are absent/i,
  /do not make a machine-wide\s+claim/i,
  /reviewed automated VM-test lane runs on GitHub-hosted Ubuntu 24\.04/i,
  /No native Windows or WSL VM-test evidence is recorded/i
]) assert.match(compatibility, boundary);

for (const contract of [
  /Do not execute a suspect file/i,
  /ports 5173 and 8788 are closed/i,
  /retain user-created projects/i,
  /Deletion alone is not revocation evidence/i,
  /no signed distributable or\s+approved candidate transport/i,
  /must not be\s+marked passed/i
]) assert.match(response, contract);

assert.match(recovery, /Windows x64[\s\S]*Linux x64[\s\S]*macOS arm64/i);
assert.match(recovery, /^Date: 2026-07-18$/m);
assert.match(recovery, /no public archive is currently distributed/i);
assert.match(recovery, /companion-support-and-incident\.md/);
assert.match(recovery, /companion-quarantine-and-withdrawal\.md/);

for (const riskyClaim of [
  /public companion (?:binary|download)s? (?:are|is) (?:available|published|supported)/i,
  /clean-machine (?:test|smoke|evidence) (?:has )?passed/i,
  /(?:rollback|revocation|withdrawal) (?:drill|evidence) (?:has )?passed/i,
  /reputation (?:check|evidence) (?:has )?passed/i
]) assert.doesNotMatch(combined, riskyClaim, `Operations docs contain unsupported claim: ${riskyClaim}`);

for (const secretLike of [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|github_pat|sk|xai)-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:mnemonic|seed phrase|private key)\s*[:=]\s*\S+/i
]) assert.doesNotMatch(combined, secretLike, "Operations docs contain secret-like material.");

console.log("Companion support, compatibility, quarantine, rollback, and withdrawal contracts passed.");
