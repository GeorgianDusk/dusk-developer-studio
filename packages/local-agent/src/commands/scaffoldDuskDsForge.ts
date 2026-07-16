import fs from "node:fs/promises";
import path from "node:path";
import { collectProjectStructureEvidence } from "./projectEvidence";
import { runBoundedProcess } from "./runBoundedProcess";
import { buildScaffoldPlan, sanitizeProjectName } from "./safePaths";
import { runScaffoldTransaction, type ScaffoldTransactionHooks } from "./transactionalScaffold";

const DUSK_FORGE_REPO = "https://github.com/dusk-network/forge";
const DEFAULT_WINDOWS_DUSKDS_ROOT = "C:\\tmp\\dusk-studio-projects";
const VERIFIED_RUST_TOOLCHAIN = "1.94.0";

function getDuskDsProjectRoot(workspaceRoot: string, configured?: string): string {
  if (configured?.trim()) return path.resolve(configured);
  return process.platform === "win32" ? path.resolve(DEFAULT_WINDOWS_DUSKDS_ROOT) : path.resolve(workspaceRoot, ".generated");
}

async function pinVerifiedRustToolchain(target: string): Promise<string> {
  const toolchainPath = path.join(target, "rust-toolchain.toml");
  const original = await fs.readFile(toolchainPath, "utf8");
  const next = original.replace(/channel\s*=\s*"[^"]+"/, `channel = "${VERIFIED_RUST_TOOLCHAIN}"`);
  if (next === original) throw new Error("Forge starter did not expose a rust-toolchain.toml channel to pin.");
  await fs.writeFile(toolchainPath, next, "utf8");
  return VERIFIED_RUST_TOOLCHAIN;
}

export interface ForgeScaffoldRuntime {
  runProcess?: typeof runBoundedProcess;
  transactionHooks?: ScaffoldTransactionHooks;
  projectRoot?: string;
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
  let rustToolchain = VERIFIED_RUST_TOOLCHAIN;
  const target = await runScaffoldTransaction(plan, async ({ stageRoot, stagedTarget }) => {
    await runProcess({
      command: "dusk-forge",
      args: ["new", projectName, "--path", stageRoot, "--no-git", "--template", "counter"],
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576
    });
    rustToolchain = await pinVerifiedRustToolchain(stagedTarget);
  }, runtime.transactionHooks);

  const evidence = await collectProjectStructureEvidence(target, ["Cargo.toml", "rust-toolchain.toml"])
    .catch(() => ({ files: [] as string[], structureVerified: false }));
  return { ok: true, path: target, projectRoot, rustToolchain, source: DUSK_FORGE_REPO, tool: "dusk-forge", platform: process.platform === "win32" ? "windows" as const : "posix" as const, ...evidence };
}
