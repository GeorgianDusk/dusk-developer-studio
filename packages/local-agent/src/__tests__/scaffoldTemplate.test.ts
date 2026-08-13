// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldFoundryTemplate } from "../commands/scaffoldTemplate";
const roots: string[] = [];
async function makeTempRoot(prefix: string): Promise<string> { const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("EVM template scaffold", () => {
  it("uses the packaged template root supplied by the trusted runtime", async () => {
    const workspace = await makeTempRoot("dusk-foundry-workspace-"); const templateRoot = await makeTempRoot("dusk-foundry-template-");
    await fs.mkdir(path.join(templateRoot, "src"), { recursive: true }); await fs.mkdir(path.join(templateRoot, "test"), { recursive: true });
    await fs.writeFile(path.join(templateRoot, "foundry.toml"), "[profile.default]\n");
    await fs.writeFile(path.join(templateRoot, ".gitignore.template"), "broadcast/\n");
    await fs.writeFile(path.join(templateRoot, "src", "Counter.sol"), "contract Counter {}\n");
    await fs.writeFile(path.join(templateRoot, "test", "Counter.t.sol"), "contract CounterTest {}\n");
    const result = await scaffoldFoundryTemplate({ cwd: workspace, projectName: "counter-project" }, { templateRoot });
    expect(result).toMatchObject({ ok: true, structureVerified: true, files: [".gitignore", "foundry.toml", "src/Counter.sol", "test/Counter.t.sol"] });
    expect(result.path).toBe(path.resolve(workspace, ".generated", "counter-project"));
    await expect(fs.readFile(path.join(result.path, ".gitignore"), "utf8")).resolves.toBe("broadcast/\n");
    await expect(fs.access(path.join(result.path, ".gitignore.template"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("verifies the complete reviewed Hardhat structure through the same transaction boundary", async () => {
    const workspace = await makeTempRoot("dusk-hardhat-workspace-");
    const templateRoot = await makeTempRoot("dusk-hardhat-template-");
    await fs.mkdir(path.join(templateRoot, "contracts"), { recursive: true });
    await fs.mkdir(path.join(templateRoot, "ignition", "modules"), { recursive: true });
    await fs.mkdir(path.join(templateRoot, "test"), { recursive: true });
    await fs.writeFile(path.join(templateRoot, "package.json"), "{\"private\":true}\n");
    await fs.writeFile(path.join(templateRoot, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    await fs.writeFile(path.join(templateRoot, "hardhat.config.ts"), "export default {};\n");
    await fs.writeFile(path.join(templateRoot, ".gitignore.template"), "artifacts/\n");
    await fs.writeFile(path.join(templateRoot, "contracts", "Counter.sol"), "contract Counter {}\n");
    await fs.writeFile(path.join(templateRoot, "ignition", "modules", "Counter.ts"), "export default {};\n");
    await fs.writeFile(path.join(templateRoot, "test", "Counter.t.sol"), "contract CounterTest {}\n");
    const requiredFiles = ["package.json", "package-lock.json", "hardhat.config.ts", "contracts/Counter.sol", "ignition/modules/Counter.ts", "test/Counter.t.sol"];

    const result = await scaffoldFoundryTemplate(
      { cwd: workspace, projectName: "hardhat-counter" },
      { templateRoot, requiredFiles }
    );

    expect(result).toMatchObject({ ok: true, structureVerified: true });
    expect(result.files).toEqual([
      ".gitignore",
      "contracts/Counter.sol",
      "hardhat.config.ts",
      "ignition/modules/Counter.ts",
      "package-lock.json",
      "package.json",
      "test/Counter.t.sol"
    ]);
    await expect(fs.readFile(path.join(result.path, ".gitignore"), "utf8")).resolves.toBe("artifacts/\n");
    await expect(fs.access(path.join(result.path, ".gitignore.template"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
