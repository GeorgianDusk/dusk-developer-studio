import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DUSK_FORGE_REPOSITORY,
  DUSK_FORGE_REVISION,
  DUSKDS_RUST_TOOLCHAIN
} from "./duskDsToolchainPolicy";
import { collectProjectStructureEvidence, type ProjectStructureEvidence } from "./projectEvidence";
import { buildScaffoldPlan, isPathInside, sanitizeProjectName } from "./safePaths";
import { runScaffoldTransaction, type ScaffoldTransactionHooks } from "./transactionalScaffold";
import {
  duskDsCounterForgeTemplateIdentity,
  scaffoldDuskDsCounterForgeTemplate
} from "../../../templates/src/duskDsCounterForge";

const REQUIRED_STARTER_FILES = [
  "Cargo.lock",
  "Cargo.toml",
  "Makefile",
  "PROVENANCE.md",
  "rust-toolchain.toml",
  "src/lib.rs",
  "tests/contract.rs"
];
const MAX_STARTER_CONTENT_BYTES = 16 * 1_024 * 1_024;
const SHA256_RE = /^[0-9a-f]{64}$/;
type ScaffoldRuntimeOs = "windows" | "linux" | "macos";

function currentRuntimeOs(platform: NodeJS.Platform = process.platform): ScaffoldRuntimeOs {
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  throw new Error(`DuskDS scaffolding is not supported on runtime platform ${platform}.`);
}

export class ScaffoldRecoveryError extends Error {
  readonly code = "scaffold_target_not_recoverable";

  constructor(message = "The existing target cannot be verified as the reviewed Studio starter.") {
    super(message);
    this.name = "ScaffoldRecoveryError";
  }
}

function getDuskDsProjectRoot(workspaceRoot: string, configured?: string): string {
  if (configured?.trim()) return path.resolve(configured);
  return path.resolve(workspaceRoot, ".generated");
}

function getDuskDsTemplateRoot(configured?: string): string {
  if (configured?.trim()) return path.resolve(configured);
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../templates/duskds-counter-forge"
  );
}

async function collectStarterContentSha256(target: string, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update("duskds-starter-content-v1\0");
  let totalBytes = 0;
  for (const file of files) {
    const absolute = path.resolve(target, ...file.split("/"));
    if (!isPathInside(target, absolute)) throw new ScaffoldRecoveryError();
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ScaffoldRecoveryError();
    totalBytes += stat.size;
    if (totalBytes > MAX_STARTER_CONTENT_BYTES) {
      throw new ScaffoldRecoveryError("The starter content exceeds the recovery verification limit.");
    }
    const content = await fs.readFile(absolute);
    if (content.byteLength !== stat.size) {
      throw new ScaffoldRecoveryError("The starter changed while its recovery receipt was being verified.");
    }
    hash.update(`${JSON.stringify(file)}:${content.byteLength}:`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

interface VerifiedStarterEvidence {
  evidence: ProjectStructureEvidence;
  contentSha256: string;
}

async function collectVerifiedStarterEvidence(target: string): Promise<VerifiedStarterEvidence> {
  const rootStat = await fs.lstat(target);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ScaffoldRecoveryError();
  }
  const toolchainPath = path.join(target, "rust-toolchain.toml");
  const toolchainStat = await fs.lstat(toolchainPath);
  if (!toolchainStat.isFile() || toolchainStat.isSymbolicLink() || toolchainStat.size > 8_192) {
    throw new ScaffoldRecoveryError();
  }
  const toolchain = await fs.readFile(toolchainPath, "utf8");
  if (!new RegExp(`channel\\s*=\\s*"${DUSKDS_RUST_TOOLCHAIN.replaceAll(".", "\\.")}"`).test(toolchain)) {
    throw new ScaffoldRecoveryError(`The existing target does not pin Rust ${DUSKDS_RUST_TOOLCHAIN}.`);
  }
  const evidence = await collectProjectStructureEvidence(target, REQUIRED_STARTER_FILES);
  if (!evidence.structureVerified) throw new ScaffoldRecoveryError();
  return {
    evidence,
    contentSha256: await collectStarterContentSha256(target, evidence.files)
  };
}

async function recoverExistingStarter(
  target: string,
  projectRoot: string,
  completionReceipt: ScaffoldCompletionReceipt | undefined
): Promise<ProjectStructureEvidence | undefined> {
  try {
    await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ScaffoldRecoveryError();
  }
  if (!completionReceipt) {
    throw new ScaffoldRecoveryError(
      "The target already exists, so Dusk Developer Studio will not overwrite or merge it. "
      + "Choose a new project name or a different empty parent directory."
    );
  }
  if (
    completionReceipt.rustToolchain !== DUSKDS_RUST_TOOLCHAIN
    || completionReceipt.templateRevision !== duskDsCounterForgeTemplateIdentity.upstreamRevision
    || completionReceipt.templateLockSha256 !== duskDsCounterForgeTemplateIdentity.templateLockSha256
    || completionReceipt.files.length > 256
    || !SHA256_RE.test(completionReceipt.contentSha256)
  ) {
    throw new ScaffoldRecoveryError();
  }
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(projectRoot), fs.realpath(target)]);
    if (!isPathInside(realRoot, realTarget)) throw new ScaffoldRecoveryError();
    const verified = await collectVerifiedStarterEvidence(target);
    const { evidence } = verified;
    if (
      evidence.files.length !== completionReceipt.files.length
      || evidence.files.some((file, index) => file !== completionReceipt.files[index])
      || verified.contentSha256 !== completionReceipt.contentSha256
    ) {
      throw new ScaffoldRecoveryError(
        "The existing target no longer matches the completed Local Studio action receipt."
      );
    }
    return evidence;
  } catch (error) {
    if (error instanceof ScaffoldRecoveryError) throw error;
    throw new ScaffoldRecoveryError();
  }
}

export interface ForgeScaffoldRuntime {
  transactionHooks?: ScaffoldTransactionHooks;
  projectRoot?: string;
  templateRoot?: string;
  completedScaffoldReceipts?: Map<string, ScaffoldCompletionReceipt>;
}

export interface ScaffoldCompletionReceipt {
  files: string[];
  rustToolchain: string;
  templateRevision: string;
  templateLockSha256: string;
  contentSha256: string;
}

function normalizedPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function scaffoldRecoveryKey(projectRoot: string, target: string, projectName: string): string {
  return JSON.stringify([
    normalizedPathKey(projectRoot),
    normalizedPathKey(target),
    projectName
  ]);
}

export async function scaffoldDuskDsForge(
  options: { cwd: string; projectName: string; parentDir?: string },
  runtime: ForgeScaffoldRuntime = {}
) {
  const projectName = sanitizeProjectName(options.projectName);
  const projectRoot = getDuskDsProjectRoot(options.cwd, runtime.projectRoot);
  const plan = buildScaffoldPlan(options.cwd, projectName, options.parentDir, {
    defaultParent: projectRoot,
    allowedRoots: [projectRoot],
    errorLabel: "the managed DuskDS project root"
  });
  if (
    duskDsCounterForgeTemplateIdentity.rustToolchain !== DUSKDS_RUST_TOOLCHAIN
    || duskDsCounterForgeTemplateIdentity.upstreamRepository !== DUSK_FORGE_REPOSITORY
    || duskDsCounterForgeTemplateIdentity.upstreamRevision !== DUSK_FORGE_REVISION
  ) {
    throw new Error("The reviewed DuskDS template identity does not match the Studio toolchain policy.");
  }
  const templateRoot = getDuskDsTemplateRoot(runtime.templateRoot);
  const recoveryKey = scaffoldRecoveryKey(projectRoot, plan.target, projectName);
  const completionReceipt = runtime.completedScaffoldReceipts?.get(recoveryKey);
  const recoveredEvidence = await recoverExistingStarter(plan.target, projectRoot, completionReceipt);
  if (recoveredEvidence) {
    return {
      ok: true,
      path: plan.target,
      projectRoot,
      rustToolchain: DUSKDS_RUST_TOOLCHAIN,
      template: duskDsCounterForgeTemplateIdentity.templateId,
      templateSource: duskDsCounterForgeTemplateIdentity.upstreamRepository,
      templateRevision: duskDsCounterForgeTemplateIdentity.upstreamRevision,
      templateLockSha256: duskDsCounterForgeTemplateIdentity.templateLockSha256,
      runtimeOs: currentRuntimeOs(),
      recovered: true,
      ...recoveredEvidence
    };
  }
  let evidence: ProjectStructureEvidence | undefined;
  let contentSha256: string | undefined;
  const target = await runScaffoldTransaction(plan, async ({ stageRoot, stagedTarget }) => {
    const created = await scaffoldDuskDsCounterForgeTemplate({
      projectName,
      projectParent: stageRoot,
      templateRoot
    });
    if (path.resolve(created.path) !== path.resolve(stagedTarget)) {
      throw new Error("The reviewed DuskDS template was written outside its transaction target.");
    }
    const verified = await collectVerifiedStarterEvidence(stagedTarget);
    evidence = verified.evidence;
    contentSha256 = verified.contentSha256;
  }, runtime.transactionHooks);

  if (!evidence?.structureVerified || !contentSha256) {
    throw new Error("The reviewed DuskDS starter structure was not verified before promotion.");
  }
  const receipts = runtime.completedScaffoldReceipts;
  if (receipts) {
    if (!receipts.has(recoveryKey) && receipts.size >= 64) {
      const oldest = receipts.keys().next().value;
      if (typeof oldest === "string") receipts.delete(oldest);
    }
    receipts.set(recoveryKey, {
      files: [...evidence.files],
      rustToolchain: DUSKDS_RUST_TOOLCHAIN,
      templateRevision: duskDsCounterForgeTemplateIdentity.upstreamRevision,
      templateLockSha256: duskDsCounterForgeTemplateIdentity.templateLockSha256,
      contentSha256
    });
  }
  return {
    ok: true,
    path: target,
    projectRoot,
    rustToolchain: DUSKDS_RUST_TOOLCHAIN,
    template: duskDsCounterForgeTemplateIdentity.templateId,
    templateSource: duskDsCounterForgeTemplateIdentity.upstreamRepository,
    templateRevision: duskDsCounterForgeTemplateIdentity.upstreamRevision,
    templateLockSha256: duskDsCounterForgeTemplateIdentity.templateLockSha256,
    runtimeOs: currentRuntimeOs(),
    recovered: false,
    ...evidence
  };
}
