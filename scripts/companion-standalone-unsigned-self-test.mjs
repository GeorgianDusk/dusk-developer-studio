import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";
import {
  STANDALONE_LIFECYCLE_RESULT_PREFIX,
  STANDALONE_MODES,
  STANDALONE_TARGETS,
  captureDirectoryIdentity,
  digestFile,
  existingBoundedPath,
  isolatedEnvironment,
  newDirectChild,
  noExtractionRoots,
  regularFile,
  removeVerifiedTree,
  runCandidate,
  validateStandaloneSelfTestResult,
  within
} from "./standalone-candidate-lifecycle-core.mjs";
import {
  ASSURANCE_LEVEL,
  UNSIGNED_INDEX_NAME,
  UNSIGNED_MANIFEST_NAME,
  UNSIGNED_RECEIPT_NAME,
  validateUnsignedLauncherIndex,
  verifyUnsignedPackageManifest
} from "./standalone-unsigned-assurance.mjs";

function hostTarget() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  return "unsupported";
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function runUnsignedCandidateLifecycle({
  target, candidatePackage, installRoot, ephemeralRoot, workspace, output
}) {
  if (!STANDALONE_TARGETS.has(target) || hostTarget() !== target) {
    throw new Error("Unsigned lifecycle target does not match this native runner.");
  }
  const ephemeralInput = path.resolve(ephemeralRoot);
  const ephemeralStat = fs.lstatSync(ephemeralInput);
  if (!ephemeralStat.isDirectory() || ephemeralStat.isSymbolicLink()) {
    throw new Error("Ephemeral runner root must be a pre-existing regular directory.");
  }
  const ephemeral = fs.realpathSync(ephemeralInput);
  const install = existingBoundedPath(ephemeral, installRoot, "Unsigned install root", "directory");
  if (path.dirname(install) !== ephemeral || !/^installed-unsigned-[A-Za-z0-9._-]+$/.test(path.basename(install))) {
    throw new Error("Unsigned install root must be a safely named direct child of the ephemeral runner root.");
  }
  const sandbox = newDirectChild(ephemeral, workspace, "Unsigned lifecycle workspace");
  const out = newDirectChild(ephemeral, output, "Unsigned lifecycle report");
  const packagePath = existingBoundedPath(ephemeral, candidatePackage, "Unsigned candidate package", "file");
  if (within(install, packagePath)) throw new Error("Unsigned candidate package must remain outside its install root.");
  const packageFile = regularFile(packagePath, "Unsigned candidate package");

  const receiptPath = existingBoundedPath(
    ephemeral, path.join(install, ...UNSIGNED_RECEIPT_NAME.split("/")), "Unsigned build receipt", "file"
  );
  const indexPath = existingBoundedPath(
    ephemeral, path.join(install, UNSIGNED_INDEX_NAME), "Unsigned launcher index", "file"
  );
  const manifestPath = existingBoundedPath(
    ephemeral, path.join(install, UNSIGNED_MANIFEST_NAME), "Unsigned candidate manifest", "file"
  );
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  validateStandaloneBuildReceipt(receipt, target);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  validateUnsignedLauncherIndex(index, { target, receipt, root: install });
  verifyUnsignedPackageManifest({
    root: install,
    target,
    buildReceipt: receiptPath,
    launcherIndex: indexPath,
    manifestFile: manifestPath
  });
  const buildReceiptSha256 = digestFile(receiptPath);
  const launcherIndexSha256 = digestFile(indexPath);
  const candidateManifestSha256 = digestFile(manifestPath);
  const launchers = {
    safe: regularFile(
      existingBoundedPath(
        ephemeral, path.join(install, ...index.launchers.safe.name.split("/")),
        "Safe unsigned launcher", "file"
      ),
      "Safe unsigned launcher"
    ),
    local_actions: regularFile(
      existingBoundedPath(
        ephemeral, path.join(install, ...index.launchers.local_actions.name.split("/")),
        "Local-actions unsigned launcher", "file"
      ),
      "Local-actions unsigned launcher"
    )
  };
  if (!within(install, launchers.safe.resolved) || !within(install, launchers.local_actions.resolved)
      || launchers.safe.resolved === launchers.local_actions.resolved) {
    throw new Error("Unsigned lifecycle launcher paths are not safely isolated.");
  }

  fs.mkdirSync(sandbox, { recursive: true, mode: 0o700 });
  const installIdentity = captureDirectoryIdentity(install, "Unsigned install root");
  const sandboxIdentity = captureDirectoryIdentity(sandbox, "Unsigned lifecycle workspace");
  const modes = {};
  let cleanupVerified = false;
  let cleanupAllowed = true;
  try {
    for (const [key, definition] of Object.entries(STANDALONE_MODES)) {
      const modeRoot = path.join(sandbox, key);
      const isolated = isolatedEnvironment(target, modeRoot);
      const modeIdentity = captureDirectoryIdentity(modeRoot, `${definition.mode} isolated root`);
      const run = await runCandidate(
        launchers[key].resolved,
        ["--signed-rc-self-test"],
        isolated.env,
        isolated.cwd
      );
      const lines = run.stdout.split(/\r?\n/)
        .filter((line) => line.startsWith(STANDALONE_LIFECYCLE_RESULT_PREFIX));
      if (lines.length !== 1) {
        throw new Error(`${definition.mode} unsigned candidate did not emit one lifecycle result.`);
      }
      const result = JSON.parse(lines[0].slice(STANDALONE_LIFECYCLE_RESULT_PREFIX.length));
      modes[key] = validateStandaloneSelfTestResult(result, {
        mode: definition.mode,
        release: { version: receipt.version, commit: receipt.commit }
      });
      const projectStat = fs.lstatSync(isolated.projectRoot);
      if (!projectStat.isDirectory() || projectStat.isSymbolicLink()
          || !within(modeRoot, isolated.projectRoot)) {
        throw new Error(`${definition.mode} candidate did not use its isolated project root.`);
      }
      if (!noExtractionRoots(isolated.temp)) {
        throw new Error(`${definition.mode} candidate left a SEA extraction root.`);
      }
      removeVerifiedTree(ephemeral, modeRoot, modeIdentity, `${definition.mode} isolated root`);
    }
    removeVerifiedTree(ephemeral, install, installIdentity, "Unsigned install root");
    removeVerifiedTree(ephemeral, sandbox, sandboxIdentity, "Unsigned lifecycle workspace");
    cleanupVerified = true;
  } catch (error) {
    if (error?.cleanupSafe === false) cleanupAllowed = false;
    throw error;
  } finally {
    if (!cleanupVerified && cleanupAllowed) {
      removeVerifiedTree(ephemeral, sandbox, sandboxIdentity, "Unsigned lifecycle workspace", {
        allowMissing: true
      });
      removeVerifiedTree(ephemeral, install, installIdentity, "Unsigned install root", {
        allowMissing: true
      });
    }
  }

  const checks = {
    safe_mode_local_action_denied: modes.safe.capability_contract_verified === true,
    local_actions_preflight_verified: modes.local_actions.capability_contract_verified === true,
    release_parity_verified: modes.safe.exact_release_parity_verified === true
      && modes.local_actions.exact_release_parity_verified === true,
    studio_listening_endpoints_verified: modes.safe.expected_studio_listening_endpoints.length === 2
      && modes.local_actions.expected_studio_listening_endpoints.length === 2,
    unexpected_studio_listening_ports_absent: modes.safe.unexpected_studio_listening_endpoints.length === 0
      && modes.local_actions.unexpected_studio_listening_endpoints.length === 0,
    isolated_user_data_roots_verified: modes.safe.isolated_project_root_verified === true
      && modes.local_actions.isolated_project_root_verified === true,
    studio_loopback_services_stopped: modes.safe.studio_loopback_services_stopped === true
      && modes.local_actions.studio_loopback_services_stopped === true,
    extraction_cleanup_verified: true,
    install_cleanup_verified: cleanupVerified
  };
  if (Object.values(checks).some((value) => value !== true)) {
    throw new Error("Unsigned lifecycle verification did not pass every bounded check.");
  }
  const report = {
    schema_version: 1,
    assurance_level: ASSURANCE_LEVEL,
    target,
    same_runner: true,
    clean_machine: false,
    platform_trust: false,
    publication_eligible: false,
    candidate_package: {
      name: path.basename(packageFile.resolved),
      bytes: packageFile.stat.size,
      sha256: digestFile(packageFile.resolved)
    },
    release: { version: receipt.version, commit: receipt.commit, channel: "portable" },
    launchers: index.launchers,
    build_receipt_sha256: buildReceiptSha256,
    unsigned_launcher_index_sha256: launcherIndexSha256,
    unsigned_candidate_manifest_sha256: candidateManifestSha256,
    modes,
    checks
  };
  fs.writeFileSync(out, canonicalJson(report), { flag: "wx", mode: 0o600 });
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    for (const name of [
      "target", "candidate-package", "install-root", "ephemeral-root", "workspace", "out"
    ]) {
      if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    const report = await runUnsignedCandidateLifecycle({
      target: args.target,
      candidatePackage: args["candidate-package"],
      installRoot: args["install-root"],
      ephemeralRoot: args["ephemeral-root"],
      workspace: args.workspace,
      output: args.out
    });
    console.log(JSON.stringify({
      status: "unsigned-engineering-lifecycle-verified",
      target: report.target,
      candidate_package_sha256: report.candidate_package.sha256
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unsigned candidate lifecycle failed.");
    process.exitCode = 1;
  }
}
