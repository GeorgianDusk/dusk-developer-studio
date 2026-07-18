import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "studio-companion-unsigned-assurance.yml"),
  "utf8"
);
const policy = JSON.parse(
  fs.readFileSync(path.join(root, "config", "companion-unsigned-assurance-policy.json"), "utf8")
);
const runtimeLock = JSON.parse(
  fs.readFileSync(path.join(root, "config", "companion-runtime-lock.json"), "utf8")
);

function assertProbeBefore(probe, observation) {
  const probeIndex = workflow.indexOf(probe);
  const observationIndex = workflow.indexOf(observation);
  assert.ok(probeIndex >= 0, `Missing native probe: ${probe}`);
  assert.ok(observationIndex > probeIndex, `Native probe must precede observation: ${probe}`);
}

assert.match(workflow, /^"on":\n {2}pull_request:/m);
assert.match(workflow, /^ {2}merge_group:$/m);
assert.match(workflow, /^ {2}push:/m);
assert.match(workflow, /^ {2}workflow_dispatch:/m);
assert.match(workflow, /^permissions:\n {2}contents: read$/m);
assert.doesNotMatch(workflow, /(?:contents|actions|packages|attestations|id-token): write/);
assert.doesNotMatch(workflow, /^\s*environment:/m);
assert.doesNotMatch(workflow, /\bsecrets\./);
assert.doesNotMatch(workflow, /gh release|create-release|action-gh-release|npm publish|pnpm publish/i);
assert.doesNotMatch(workflow, /Azure\/login|artifact-signing|cosign|notarytool|stapler staple|Developer ID/i);
assert.doesNotMatch(workflow, /actions\/cache@/i);
assert.doesNotMatch(workflow, /^\s+cache:\s+/m);
for (const match of workflow.matchAll(/package-manager-cache:\s*([^\n]+)/g)) {
  assert.match(match[1].trim(), /^"?false"?$/);
}

assert.match(workflow, /EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
assert.doesNotMatch(workflow, /needs\.scope|Classify unsigned companion assurance scope|Report scope-only/);
assert.match(workflow, /^ {2}result:\n {4}name: Unsigned companion engineering assurance/m);
assert.match(workflow, /^ {4}if: always\(\)$/m);
assert.match(workflow, /Report bounded result/);
for (const result of ["PREFLIGHT_RESULT", "WINDOWS_RESULT", "LINUX_RESULT", "MACOS_RESULT"]) {
  assert.match(workflow, new RegExp(`test "\\$${result}" = success`));
}

for (const [target, runner] of Object.entries(policy.runner_labels)) {
  assert.match(workflow, new RegExp(`name: Unsigned engineering lifecycle \\(${target.replaceAll("-", "\\-")}\\)`));
  assert.match(workflow, new RegExp(`runs-on: ${runner.replaceAll(".", "\\.")}`));
}
assert.equal(policy.node_version, runtimeLock.runtime.version);
assert.match(workflow, new RegExp(`NODE_VERSION: ${policy.node_version.replaceAll(".", "\\.")}`));
assert.match(workflow, new RegExp(`PNPM_VERSION: ${policy.pnpm_version.replaceAll(".", "\\.")}`));
for (const target of Object.values(runtimeLock.runtime.targets)) {
  assert.ok(workflow.includes(target.archive_url), `Unsigned workflow is missing ${target.archive_url}.`);
}

for (const pin of [
  "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020"
]) {
  assert.match(workflow, new RegExp(pin));
}
assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact@|retention-days:/i);
assert.doesNotMatch(workflow, /^\s*uses:\s+[^\s@]+@(?![a-f0-9]{40}(?:\s|$))/m);

assert.equal((workflow.match(/--operation=reproducibility/g) ?? []).length, 3);
assert.equal((workflow.match(/companion-standalone-unsigned-self-test\.mjs/g) ?? []).length, 3);
assert.equal((workflow.match(/--profile=unsigned-engineering/g) ?? []).length, 6);
assert.equal((workflow.match(/--operation=cleanup/g) ?? []).length, 3);
assert.equal((workflow.match(/--scope-root=/g) ?? []).length, 3);
assert.equal((workflow.match(/--operation=target-evidence/g) ?? []).length, 3);
assert.equal((workflow.match(/--operation=aggregate/g) ?? []).length, 0);
assert.equal((workflow.match(/--macos-app-receipt=/g) ?? []).length, 1);
assert.equal(
  (workflow.match(/--operation=target-evidence[^\n]*--expected-commit=[^\s]+[^\n]*--checks=[^\s]+/g) ?? []).length,
  3
);
for (const stepName of [
  "Delete every workflow-owned unsigned Windows candidate path before recording evidence",
  "Delete every workflow-owned unsigned Linux candidate path before recording evidence",
  "Delete every workflow-owned unsigned macOS candidate path before recording evidence"
]) {
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(workflow, new RegExp(`- name: ${escaped}\\n {8}if: always\\(\\)`));
}
for (const [target, platform] of Object.entries({
  "windows-x64": "Windows",
  "linux-x64": "Linux",
  "darwin-arm64": "macOS"
})) {
  const start = workflow.indexOf(
    `- name: Delete every workflow-owned unsigned ${platform} candidate path before recording evidence`
  );
  const end = workflow.indexOf(`--operation=target-evidence --target=${target}`, start);
  assert.ok(start >= 0 && end > start, `${target} cleanup block is missing.`);
  const block = workflow.slice(start, end);
  assert.match(block, /--scope-root=/);
  const ids = target === "windows-x64"
    ? [...block.matchAll(/^ {12}([a-z0-9_]+) = \(Join-Path/gm)].map((match) => match[1])
    : [...block.matchAll(/^ {12}"([a-z0-9_]+)=\$RUNNER_TEMP\//gm)].map((match) => match[1]);
  assert.deepEqual(ids, Object.keys(policy.cleanup_paths[target]));
  for (const [id, relative] of Object.entries(policy.cleanup_paths[target])) {
    const expected = target === "windows-x64"
      ? `${id} = (Join-Path $env:RUNNER_TEMP '${relative}')`
      : `"${id}=$RUNNER_TEMP/${relative}"`;
    assert.ok(block.includes(expected), `${target} cleanup path is not canonical: ${id}.`);
  }
  if (target === "windows-x64") {
    assert.match(block, /-notin @\('standard_user_root', 'install_root', 'lifecycle_workspace'\)/);
    assert.match(block, /\$unsafeLifecycleTree/);
  } else {
    assert.match(block, /install_root\|lifecycle_workspace\) ;;/);
  }
}
assert.doesNotMatch(workflow, /rm -rf -- "\$\{cleanup_records\[@\]\}"/);

const windowsObservation = "--operation=platform-observations --target=windows-x64";
for (const probe of [
  "Get-AuthenticodeSignature",
  "$signature.Status -ne 'NotSigned'",
  "MpCmdRun.exe",
  "Microsoft Defender scan failed"
]) assertProbeBefore(probe, windowsObservation);
assert.doesNotMatch(workflow, /HashMismatch|defender_scan_passed/);

const linuxObservation = "--operation=platform-observations --target=linux-x64";
for (const probe of [
  "ELF 64-bit LSB",
  "GNU_STACK",
  "06000",
  "unexpectedly contains a detached trust artifact"
]) assertProbeBefore(probe, linuxObservation);

const macosObservation = "--operation=platform-observations --target=darwin-arm64";
for (const probe of [
  "codesign --verify --strict",
  "Signature=adhoc",
  'test "$gatekeeper_status" -ne 0',
  "rejected([[:space:]]|$)"
]) assertProbeBefore(probe, macosObservation);

assert.equal(policy.assurance_level, "unsigned-engineering-only");
assert.equal(policy.same_runner, true);
assert.equal(policy.clean_machine, false);
assert.equal(policy.platform_trust, false);
assert.equal(policy.publication_eligible, false);
assert.equal(policy.retention_scope, "workflow-owned-candidate-paths-only");
assert.equal(policy.scoped_candidate_paths_absent_at_check, true);
assert.deepEqual(Object.keys(policy.cleanup_paths), [
  "windows-x64", "linux-x64", "darwin-arm64"
]);
for (const paths of Object.values(policy.cleanup_paths)) {
  const ids = Object.keys(paths);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(Object.values(paths)).size, ids.length);
}
assert.ok(policy.required_checks.includes("scoped_candidate_paths_absent_at_check"));
assert.ok(policy.required_checks.includes("non_elevated_launch_verified"));
assert.ok(policy.limitations.some((value) => /detached same-user/i.test(value)));
assert.ok(policy.limitations.some((value) => /not OS containment.*administrator or root/i.test(value)));
assert.ok(policy.limitations.some((value) => /not authenticated publication evidence/i.test(value)));
assert.ok(policy.limitations.some((value) => /point-in-time.*workflow-owned candidate paths/i.test(value)));
assert.ok(policy.limitations.some((value) => /pull request code can change this lane/i.test(value)));
assert.match(workflow, /Dusk Developer Studio refuses elevated or root execution/);
assert.equal((workflow.match(/Dusk Developer Studio refuses elevated or root execution/g) ?? []).length, 3);
assert.equal((workflow.match(/sudo -n --/g) ?? []).length, 2);
assert.equal((workflow.match(/before_elevated_probe=/g) ?? []).length, 2);
assert.match(workflow, /New-LocalUser -Name \$userName/);
assert.match(workflow, /\$lifecycleInfo\.UserName = \$userName/);
assert.match(workflow, /Copy-Item -LiteralPath \(Join-Path \$env:GITHUB_WORKSPACE 'scripts'\) -Destination \(Join-Path \$driverRoot 'scripts'\) -Recurse/);
assert.match(workflow, /Copy-Item -LiteralPath \(Join-Path \$env:GITHUB_WORKSPACE 'config'\) -Destination \(Join-Path \$driverRoot 'config'\) -Recurse/);
assert.match(workflow, /Copy-Item -LiteralPath \(Join-Path \$env:GITHUB_WORKSPACE 'package\.json'\) -Destination \(Join-Path \$driverRoot 'package\.json'\)/);
assert.match(workflow, /Copy-Item -LiteralPath \(Get-Command node\)\.Source -Destination \(Join-Path \$driverRoot 'node\.exe'\)/);
assert.match(workflow, /icacls\.exe'\) \$standardUserRoot \/inheritance:r \/grant:r[\s\S]*?\/T \/C/);
assert.match(workflow, /\$lifecycleInfo\.WorkingDirectory = \$driverRoot/);
assert.match(workflow, /\$lifecycleInfo\.Environment\.Clear\(\)/);
assert.match(workflow, /Remove-LocalUser -Name \$userName -ErrorAction Stop/);
const lifecycleBlock = workflow.slice(
  workflow.indexOf("$lifecycleInfo = [System.Diagnostics.ProcessStartInfo]::new()"),
  workflow.indexOf("node scripts/standalone-unsigned-assurance.mjs --operation=platform-observations --target=windows-x64")
);
assert.doesNotMatch(lifecycleBlock, /ReadToEnd|RedirectStandardOutput|RedirectStandardError/);
const removeUser = lifecycleBlock.indexOf("Remove-LocalUser -Name $userName -ErrorAction Stop");
const verifyUserAbsent = lifecycleBlock.indexOf("Get-LocalUser -Name $userName", removeUser);
assert.ok(removeUser >= 0 && verifyUserAbsent > removeUser, "Standard-user account cleanup must be fail-closed and verified.");
assert.deepEqual(
  [...lifecycleBlock.matchAll(/\$lifecycleInfo\.Environment\['([^']+)'\] =/g)].map((match) => match[1]),
  [
    "SystemRoot", "WINDIR", "COMSPEC", "SystemDrive", "PATHEXT", "PATH",
    "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"
  ]
);
assert.doesNotMatch(workflow, /ALLOW_ELEVATED|SKIP_(?:ELEVATION|PRIVILEGE)|elevation[_-]bypass/i);

console.log("Unsigned companion workflow static security contract passed.");
