import fs from "node:fs/promises";
import path from "node:path";
import {
  assertReviewedDuskForgeIdentity,
  DUSK_FORGE_BINARY,
  DUSK_FORGE_REPOSITORY,
  DUSKDS_RUST_TOOLCHAIN,
  readReviewedDuskForgeIdentity,
  reviewedDuskForgeExecutable,
  type DuskForgeInstallIdentity
} from "./duskDsToolchainPolicy";
import { collectProjectStructureEvidence } from "./projectEvidence";
import { runBoundedProcess } from "./runBoundedProcess";
import { buildScaffoldPlan, sanitizeProjectName } from "./safePaths";
import { runScaffoldTransaction, type ScaffoldTransactionHooks } from "./transactionalScaffold";

const DEFAULT_WINDOWS_DUSKDS_ROOT = "C:\\tmp\\dusk-studio-projects";

function getDuskDsProjectRoot(workspaceRoot: string, configured?: string): string {
  if (configured?.trim()) return path.resolve(configured);
  return process.platform === "win32" ? path.resolve(DEFAULT_WINDOWS_DUSKDS_ROOT) : path.resolve(workspaceRoot, ".generated");
}

async function pinVerifiedRustToolchain(target: string): Promise<string> {
  const toolchainPath = path.join(target, "rust-toolchain.toml");
  const original = await fs.readFile(toolchainPath, "utf8");
  const next = original.replace(/channel\s*=\s*"[^"]+"/, `channel = "${DUSKDS_RUST_TOOLCHAIN}"`);
  if (next === original) throw new Error("Forge starter did not expose a rust-toolchain.toml channel to pin.");
  await fs.writeFile(toolchainPath, next, "utf8");
  return DUSKDS_RUST_TOOLCHAIN;
}

export interface ForgeScaffoldRuntime {
  runProcess?: typeof runBoundedProcess;
  transactionHooks?: ScaffoldTransactionHooks;
  projectRoot?: string;
  cargoInstallRoot?: string;
  readDuskForgeIdentity?: () => Promise<DuskForgeInstallIdentity>;
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
    errorLabel: "the Studio workspace or configured DuskDS project root"
  });
  const runProcess = runtime.runProcess ?? runBoundedProcess;
  const forgeIdentity = assertReviewedDuskForgeIdentity(
    await (runtime.readDuskForgeIdentity ?? (() => readReviewedDuskForgeIdentity({ cargoInstallRoot: runtime.cargoInstallRoot })))()
  );
  let rustToolchain = DUSKDS_RUST_TOOLCHAIN;
  const target = await runScaffoldTransaction(plan, async ({ stageRoot, stagedTarget }) => {
    await runProcess({
      command: reviewedDuskForgeExecutable(runtime.cargoInstallRoot),
      args: ["new", projectName, "--path", stageRoot, "--no-git", "--template", "counter"],
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576
    });
    rustToolchain = await pinVerifiedRustToolchain(stagedTarget);
  }, runtime.transactionHooks);

  const evidence = await collectProjectStructureEvidence(target, ["Cargo.toml", "rust-toolchain.toml"])
    .catch(() => ({ files: [] as string[], structureVerified: false }));
  return {
    ok: true,
    path: target,
    projectRoot,
    rustToolchain,
    source: DUSK_FORGE_REPOSITORY,
    tool: DUSK_FORGE_BINARY,
    forgePackage: forgeIdentity.package,
    forgeVersion: forgeIdentity.packageVersion,
    forgeRevision: forgeIdentity.revision,
    platform: process.platform === "win32" ? "windows" as const : "posix" as const,
    ...evidence
  };
}
