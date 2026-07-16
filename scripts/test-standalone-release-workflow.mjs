import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workflowPath = path.join(root, ".github", "workflows", "studio-companion-signed-rc.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^"on":\n {2}workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^ {2}(?:push|pull_request|schedule):/m);
assert.match(workflow, /release_tag:[\s\S]*approval_reference:/);
assert.match(workflow, /test "\$GITHUB_REF" = "refs\/tags\/\$RELEASE_TAG"/);
assert.equal((workflow.match(/environment: studio-companion-signing/g) ?? []).length, 3);
assert.equal((workflow.match(/id-token: write/g) ?? []).length, 2);
assert.doesNotMatch(workflow, /contents: write|packages: write|actions: write/);
assert.doesNotMatch(workflow, /gh release|create-release|softprops\/action-gh-release|release-action/i);
assert.doesNotMatch(workflow, /products\/developer-testnet-studio|dusk-network\/marketing/);
assert.match(workflow, /GeorgianDusk\/dusk-developer-studio/);

for (const runner of ["windows-2025", "ubuntu-24.04", "macos-14"]) assert.match(workflow, new RegExp(`runs-on: ${runner.replaceAll(".", "[.]")}`));
for (const pin of [
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
  "Azure/login@93381592711f247e165c389ebb30b596c84cdc48",
  "Azure/artifact-signing-action@208f8af4bf26cf2af8597424e3cb5582801523ba"
]) assert.match(workflow, new RegExp(pin));
assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?![a-f0-9]{40}(?:\s|$))/m);

for (const contract of [
  "Get-AuthenticodeSignature",
  "timestamp-rfc3161",
  "MpCmdRun.exe",
  "cosign sign-blob --yes --bundle",
  "--certificate-oidc-issuer https://token.actions.githubusercontent.com",
  'test "$(uname -m)" = arm64',
  "standalone-macos-app.mjs",
  "codesign --force --options runtime --timestamp",
  "xcrun notarytool submit",
  "xcrun stapler staple",
  "spctl --assess --type execute"
]) assert.ok(workflow.includes(contract), `Missing workflow contract: ${contract}`);

for (const job of ["smoke-windows", "smoke-linux", "smoke-macos"]) assert.match(workflow, new RegExp(`^  ${job}:$`, "m"));
assert.equal((workflow.match(/--signed-rc-self-test/g) ?? []).length, 3);
assert.equal((workflow.match(/standalone-target-evidence\.mjs/g) ?? []).length, 3);
assert.match(workflow, /needs: \[smoke-windows, smoke-linux, smoke-macos\]/);
assert.match(workflow, /assemble-standalone-signing-evidence\.mjs/);
assert.match(workflow, /--report-only/);
assert.match(workflow, /if: always\(\)[\s\S]*security delete-keychain/);

console.log("Standalone signed-RC workflow static security contract passed.");
