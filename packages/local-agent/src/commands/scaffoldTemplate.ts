import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectProjectStructureEvidence } from "./projectEvidence";
import { buildScaffoldPlan } from "./safePaths";
import { runScaffoldTransaction, type ScaffoldTransactionHooks } from "./transactionalScaffold";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE_ROOT = path.resolve(__dirname, "../../../templates/foundry-counter-dusk-evm");

export interface FoundryScaffoldRuntime extends ScaffoldTransactionHooks { templateRoot?: string; }

export async function scaffoldFoundryTemplate(
  options: { cwd: string; projectName: string; parentDir?: string },
  runtime: FoundryScaffoldRuntime = {}
) {
  const templateRoot = path.resolve(runtime.templateRoot ?? DEFAULT_TEMPLATE_ROOT);
  const plan = buildScaffoldPlan(options.cwd, options.projectName, options.parentDir);
  const target = await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
    await fs.cp(templateRoot, stagedTarget, { recursive: true, force: false, errorOnExist: true });
  }, runtime);
  const evidence = await collectProjectStructureEvidence(target, ["foundry.toml", "src/Counter.sol", "test/Counter.t.sol"])
    .catch(() => ({ files: [] as string[], structureVerified: false }));
  return { ok: true, path: target, ...evidence };
}
