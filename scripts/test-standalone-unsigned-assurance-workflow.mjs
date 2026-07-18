import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "studio-companion-unsigned-assurance.yml"),
  "utf8"
);
const windowsLifecycleDriver = fs.readFileSync(
  path.join(root, "scripts", "windows-standard-user-lifecycle.ps1"),
  "utf8"
);
const windowsBootstrap = fs.readFileSync(
  path.join(root, "scripts", "windows-standard-user-bootstrap.ps1"),
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
assert.doesNotMatch(workflow, /\b[0-9]+_[0-9]+\b/);
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
assert.match(
  workflow,
  /\$standardUserRoot = Join-Path \$env:RUNNER_TEMP 'unsigned-windows-standard-user'[\s\S]*\$stage = Join-Path \$standardUserRoot 'package-stage'/
);
assert.match(
  workflow,
  /standalone-safe-zip-extract\.mjs --create "--root=\$stage" --target=windows-x64 "--ephemeral-root=\$standardUserRoot" "--out=\$package"/
);

const linuxObservation = "--operation=platform-observations --target=linux-x64";
for (const probe of [
  "ELF 64-bit LSB",
  "GNU_STACK",
  "06000",
  "unexpectedly contains a detached trust artifact"
]) assertProbeBefore(probe, linuxObservation);

const macosObservation = "--operation=platform-observations --target=darwin-arm64";
for (const probe of [
  '"$safe_app|$sea/$safe_name"',
  '"$actions_app|$sea/$actions_name"',
  'cmp -s "$source_executable" "$executable"',
  'codesign --verify --strict --verbose=4 "$source_executable"',
  'codesign -d --verbose=4 "$source_executable" 2>&1',
  'test "$gatekeeper_status" -ne 0',
  "rejected([[:space:]]|$)",
  "code has no resources but signature indicates they must be present"
]) assertProbeBefore(probe, macosObservation);
assert.doesNotMatch(workflow, /codesign --verify --strict --verbose=4 "\$executable"/);

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
assert.match(workflow, /Copy-Item -LiteralPath \(Join-Path \$env:GITHUB_WORKSPACE 'scripts'\) -Destination \(Join-Path \$driverRoot 'scripts'\) -Recurse/);
assert.match(workflow, /Copy-Item -LiteralPath \(Join-Path \$env:GITHUB_WORKSPACE 'config'\) -Destination \(Join-Path \$driverRoot 'config'\) -Recurse/);
assert.match(workflow, /Copy-Item -LiteralPath \(Join-Path \$env:GITHUB_WORKSPACE 'package\.json'\) -Destination \(Join-Path \$driverRoot 'package\.json'\)/);
assert.match(workflow, /Copy-Item -LiteralPath \(Get-Command node\)\.Source -Destination \(Join-Path \$driverRoot 'node\.exe'\)/);
assert.match(workflow, /icacls\.exe'\) \$standardUserRoot \/inheritance:r \/grant:r[\s\S]*?\/T \/C/);
assert.match(workflow, /timeout_ms = 300000/);
assert.match(workflow, /\$credentialStartInfo = \[System\.Diagnostics\.ProcessStartInfo\]::new\(\)/);
assert.match(workflow, /\$credentialStartInfo\.FileName = \(Get-Command pwsh\)\.Source/);
assert.match(workflow, /\$credentialStartInfo\.WorkingDirectory = \$driverRoot/);
assert.match(workflow, /\$credentialStartInfo\.UseShellExecute = \$false/);
assert.match(workflow, /\$credentialStartInfo\.CreateNoWindow = \$true/);
assert.match(workflow, /\$credentialStartInfo\.RedirectStandardInput = \$true/);
assert.match(workflow, /\$credentialStartInfo\.RedirectStandardOutput = \$true/);
assert.match(workflow, /\$credentialStartInfo\.RedirectStandardError = \$true/);
assert.match(workflow, /\$credentialStartInfo\.UserName = \$userName/);
assert.match(workflow, /\$credentialStartInfo\.Domain = \$env:COMPUTERNAME/);
assert.match(workflow, /\$credentialStartInfo\.Password = \$securePassword/);
assert.match(workflow, /\$credentialStartInfo\.LoadUserProfile = \$false/);
assert.match(workflow, /\$credentialStartInfo\.UseCredentialsForNetworkingOnly = \$false/);
assert.match(workflow, /\$credentialStartInfo\.Environment\.Clear\(\)/);
assert.match(workflow, /foreach \(\$environmentName in \$launchContract\.environment\.Keys\)/);
const credentialEnvironment = workflow.slice(
  workflow.indexOf("environment = [ordered]@{"),
  workflow.indexOf("stdout_path = $launchStdout")
);
assert.doesNotMatch(credentialEnvironment, /GITHUB_|TOKEN|SECRET|PASSWORD|CREDENTIAL/i);
assert.match(workflow, /\$credentialStartInfo\.ArgumentList\.Add\(\$launchArgument\)/);
assert.match(workflow, /\$launchCommandLengthBound -gt 900/);
assert.match(workflow, /\$credentialProcess\.StandardInput\.Close\(\)/);
assert.doesNotMatch(workflow, /PasswordInClearText|LoadUserProfile = \$true|UseCredentialsForNetworkingOnly = \$true/);
assert.doesNotMatch(workflow, /Schedule\.Service|RegisterTaskDefinition|New-ScheduledTask|Register-ScheduledTask|schtasks\.exe|SeBatchLogonRight|windows-lsa-account-rights/i);
const credentialArgumentsStart = workflow.indexOf("$launchArguments = @(");
const credentialArguments = workflow.slice(
  credentialArgumentsStart,
  workflow.indexOf("foreach ($launchArgument in $launchArguments)", credentialArgumentsStart)
);
assert.doesNotMatch(credentialArguments, /\$passwordText|\$securePassword|PasswordInClearText/i);
const convertPassword = workflow.indexOf("$securePassword = ConvertTo-SecureString");
const makePasswordReadOnly = workflow.indexOf("$securePassword.MakeReadOnly()", convertPassword);
const clearPlainPassword = workflow.indexOf("$passwordText = $null", makePasswordReadOnly);
const createStandardUser = workflow.indexOf("$standardUser = New-LocalUser", clearPlainPassword);
const credentialStart = workflow.indexOf("$credentialProcess = [System.Diagnostics.Process]::Start($credentialStartInfo)");
const clearProcessPassword = workflow.indexOf("$credentialStartInfo.Password = $null", credentialStart);
const disposeSecurePassword = workflow.indexOf("$securePassword.Dispose()", clearProcessPassword);
assert.ok(
  convertPassword >= 0
    && makePasswordReadOnly > convertPassword
    && clearPlainPassword > makePasswordReadOnly
    && createStandardUser > clearPlainPassword
    && credentialStart > createStandardUser
    && clearProcessPassword > credentialStart
    && disposeSecurePassword > clearProcessPassword,
  "Credential material must be cleared immediately after the alternate-credential process starts."
);
assert.match(workflow, /\$credentialProcess\.StandardOutput\.ReadToEndAsync\(\)/);
assert.match(workflow, /\$credentialProcess\.StandardError\.ReadToEndAsync\(\)/);
assert.match(workflow, /\$credentialProcess\.WaitForExit\(420000\)/);
assert.match(workflow, /\$credentialProcess\.Kill\(\$true\)[\s\S]*?\$credentialProcess\.WaitForExit\(15000\)/);
assert.match(workflow, /\[System\.Threading\.Tasks\.Task\]::WaitAll\(\$bootstrapOutputTasks, 15000\)/);
assert.match(workflow, /standard-user status: exit_code=\$\(\$failedTaskStatus\.exit_code\)/);
assert.match(workflow, /standard-user diagnostic: \$diagnosticMessage/);
assert.match(workflow, /\$diagnosticFile\.Length -gt 4096/);
assert.match(workflow, /Successful standard-user Windows lifecycle left a failure diagnostic/);
assert.match(workflow, /\$status\.nonce -ne \$launchNonce[\s\S]*?\$status\.sid -ne \$standardUserSid[\s\S]*?\$status\.is_admin -ne \$false[\s\S]*?\$status\.exit_code -ne 0/);
assert.match(workflow, /Remove-LocalUser -Name \$userName -ErrorAction Stop/);
const lifecycleBlock = workflow.slice(
  workflow.indexOf("$userName = 'DuskStudioAssurance'"),
  workflow.indexOf("node scripts/standalone-unsigned-assurance.mjs --operation=platform-observations --target=windows-x64")
);
const removeUser = lifecycleBlock.indexOf("Remove-LocalUser -Name $userName -ErrorAction Stop");
const verifyUserAbsent = lifecycleBlock.indexOf("Get-LocalUser -Name $userName", removeUser);
assert.ok(removeUser >= 0 && verifyUserAbsent > removeUser, "Standard-user account cleanup must be fail-closed and verified.");
const sweepOwnedProcesses = lifecycleBlock.indexOf("$remainingOwnedProcesses = @(Get-ProcessesOwnedBySid -Sid $standardUserSid)");
const removeProfile = lifecycleBlock.indexOf("Remove-CimInstance -InputObject $profile");
assert.ok(
  sweepOwnedProcesses >= 0 && removeProfile > sweepOwnedProcesses && removeUser > removeProfile,
  "Exact-SID process, profile, and account cleanup must be ordered and fail-closed."
);
assert.match(lifecycleBlock, /Get-ProcessesOwnedBySid -Sid \$standardUserSid/);
assert.doesNotMatch(
  lifecycleBlock.slice(
    lifecycleBlock.indexOf("function Get-ProcessesOwnedBySid"),
    lifecycleBlock.indexOf("$driverRoot =")
  ),
  /Get-Process -Id|catch \{[\s\S]{0,100}throw/
);
assert.match(lifecycleBlock, /Get-CimInstance Win32_UserProfile -Filter "SID='\$standardUserSid'"/);
assert.match(lifecycleBlock, /if \(\$profileMatches\.Count -eq 0\)[\s\S]*?\$profile = \$null[\s\S]*?break/);
assert.match(lifecycleBlock, /\$profilePath\.StartsWith\(\$usersPrefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
assert.doesNotMatch(lifecycleBlock, /\[GC\]::WaitForPendingFinalizers\(\)/);
assert.match(lifecycleBlock, /\$profileDeadline = \[DateTime\]::UtcNow\.AddSeconds\(120\)/);
assert.match(lifecycleBlock, /Temporary assurance profile remained loaded after its release deadline/);
assert.match(lifecycleBlock, /\$refreshedProfilePath\.Equals\([\s\S]*?\$profilePath/);
assert.match(lifecycleBlock, /\$finalProfilePath\.Equals\([\s\S]*?\$profilePath/);
assert.match(lifecycleBlock, /Temporary assurance profile hive survived cleanup/);
assert.doesNotMatch(lifecycleBlock, /Remove-Item[\s\S]{0,200}(?:C:\\Users|\\Users\\|Join-Path \$env:SystemDrive 'Users')/i);

assert.match(windowsLifecycleDriver, /\[System\.Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)/);
assert.match(windowsLifecycleDriver, /\$identity\.User\.Value -ne \$contract\.expected_sid/);
assert.match(windowsLifecycleDriver, /\[System\.Security\.Principal\.WindowsBuiltInRole\]::Administrator/);
assert.match(windowsLifecycleDriver, /function Assert-NoReparseComponents/);
assert.match(windowsLifecycleDriver, /\$item\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint/);
for (const prefix of [
  "--candidate-package=",
  "--install-root=",
  "--ephemeral-root=",
  "--workspace=",
  "--out="
]) {
  assert.ok(windowsLifecycleDriver.includes(prefix), `Windows lifecycle driver is missing exact argument binding: ${prefix}`);
}
assert.match(windowsLifecycleDriver, /\$processInfo\.Environment\.Clear\(\)/);
const allowedEnvironmentBlock = windowsLifecycleDriver.slice(
  windowsLifecycleDriver.indexOf("$allowedEnvironmentNames = @("),
  windowsLifecycleDriver.indexOf("$maximumLogBytes = 65536")
);
assert.deepEqual(
  [...allowedEnvironmentBlock.matchAll(/^ {2}'([^']+)'[,]?$/gm)].map((match) => match[1]),
  [
    "SystemRoot", "WINDIR", "COMSPEC", "SystemDrive", "PATHEXT", "PATH",
    "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"
  ]
);
assert.match(windowsLifecycleDriver, /\$processInfo\.ArgumentList\.Add\(\$scriptPath\)/);
assert.match(windowsLifecycleDriver, /if \(\$contract\.timeout_ms -ne 300000\)/);
assert.match(windowsLifecycleDriver, /\$process\.StandardOutput\.ReadToEndAsync\(\)/);
assert.match(windowsLifecycleDriver, /\$process\.StandardError\.ReadToEndAsync\(\)/);
assert.match(windowsLifecycleDriver, /\$process\.WaitForExit\(\[int\] \$contract\.timeout_ms\)/);
assert.match(windowsLifecycleDriver, /\$process\.Kill\(\$true\)[\s\S]*?\$process\.WaitForExit\(15000\)/);
assert.doesNotMatch(windowsLifecycleDriver, /\$process\.WaitForExit\(\)/);
assert.match(windowsLifecycleDriver, /\$maximumLogBytes = 65536/);
assert.match(windowsLifecycleDriver, /\[System\.IO\.File\]::Move\(\$statusTemporaryPath, \$statusPath\)/);
assert.doesNotMatch(windowsLifecycleDriver, /UserName\s*=|Domain\s*=|Password\s*=|credential|TASK_LOGON_PASSWORD/i);
assert.match(windowsBootstrap, /Assert-BoundedPath/);
assert.match(windowsBootstrap, /\$item\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint/);
assert.match(windowsBootstrap, /& \$driverPath -InputFile \$inputPath/);
assert.match(windowsBootstrap, /\$message\.Length -gt 1024/);
assert.match(windowsBootstrap, /\[System\.IO\.File\]::Move\(\$temporaryDiagnostic, \$diagnosticPath\)/);
assert.doesNotMatch(windowsBootstrap, /UserName\s*=|Domain\s*=|Password\s*=|credential/i);
assert.doesNotMatch(workflow, /ALLOW_ELEVATED|SKIP_(?:ELEVATION|PRIVILEGE)|elevation[_-]bypass/i);

console.log("Unsigned companion workflow static security contract passed.");
