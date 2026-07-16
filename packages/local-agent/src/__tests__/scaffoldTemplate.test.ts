// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldFoundryTemplate } from "../commands/scaffoldTemplate";
const roots: string[] = [];
async function makeTempRoot(prefix: string): Promise<string> { const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("Foundry template scaffold", () => {
  it("uses the packaged template root supplied by the trusted runtime", async () => {
    const workspace = await makeTempRoot("dusk-foundry-workspace-"); const templateRoot = await makeTempRoot("dusk-foundry-template-");
    await fs.mkdir(path.join(templateRoot, "src"), { recursive: true }); await fs.mkdir(path.join(templateRoot, "test"), { recursive: true });
    await fs.writeFile(path.join(templateRoot, "foundry.toml"), "[profile.default]\n");
    await fs.writeFile(path.join(templateRoot, "src", "Counter.sol"), "contract Counter {}\n");
    await fs.writeFile(path.join(templateRoot, "test", "Counter.t.sol"), "contract CounterTest {}\n");
    const result = await scaffoldFoundryTemplate({ cwd: workspace, projectName: "portable-counter" }, { templateRoot });
    expect(result).toMatchObject({ ok: true, structureVerified: true, files: ["foundry.toml", "src/Counter.sol", "test/Counter.t.sol"] });
    expect(result.path).toBe(path.resolve(workspace, ".generated", "portable-counter"));
  });
});
