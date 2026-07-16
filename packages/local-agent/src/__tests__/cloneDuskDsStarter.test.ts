import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scaffoldDuskDsForge } from "../commands/scaffoldDuskDsForge";

let tempRoots: string[] = [];
let previousDuskDsProjectRoot: string | undefined;

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-studio-"));
  tempRoots.push(root);
  return root;
}

async function createMockForgeProject(stageRoot: string, projectName: string) {
  const target = path.resolve(stageRoot, projectName);
  await fs.mkdir(path.join(target, "src"), { recursive: true });
  await fs.writeFile(path.join(target, "Cargo.toml"), '[package]\nname = "counter"\n');
  await fs.writeFile(path.join(target, "src", "lib.rs"), "pub fn counter() {}\n");
  await fs.writeFile(path.join(target, "rust-toolchain.toml"), '[toolchain]\nchannel = "stable"\n');
}

describe("DuskDS Forge scaffold", () => {
  beforeEach(() => {
    previousDuskDsProjectRoot = process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT;
  });

  afterEach(async () => {
    if (previousDuskDsProjectRoot === undefined) delete process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT;
    else process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT = previousDuskDsProjectRoot;
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots = [];
  });

  it("scaffolds the official Forge counter template into the configured project root transactionally", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const runProcess = vi.fn(async (options: { args: string[] }) => {
      await createMockForgeProject(options.args[3], String(options.args[1]));
      return { stdout: "ok", stderr: "", exitCode: 0 };
    });

    const result = await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo", parentDir: "tmp/qa" },
      { runProcess, projectRoot }
    );

    expect(result).toMatchObject({ ok: true, source: "https://github.com/dusk-network/forge", tool: "dusk-forge", projectRoot, rustToolchain: "1.94.0", structureVerified: true });
    expect(result.path).toBe(path.resolve(projectRoot, "tmp/qa", "native-demo"));
    await expect(fs.readFile(path.join(result.path, "rust-toolchain.toml"), "utf8")).resolves.toContain('channel = "1.94.0"');
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: "dusk-forge",
      args: ["new", "native-demo", "--path", expect.stringMatching(/\.dusk-studio-stage-/), "--no-git", "--template", "counter"],
      timeoutMs: 300_000,
      maxOutputBytes: 1_048_576
    }));
    expect((await fs.readdir(path.dirname(result.path))).filter((name) => name.startsWith(".dusk-studio-stage-"))).toEqual([]);
  });

  it("does not scaffold into an existing target, including an empty directory", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const target = path.resolve(projectRoot, "tmp/qa/native-demo");
    await fs.mkdir(target, { recursive: true });
    const runProcess = vi.fn();

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo", parentDir: "tmp/qa" },
      { runProcess, projectRoot }
    )).rejects.toThrow("already exists");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("removes the private stage after a bounded process failure", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const runProcess = vi.fn(async () => { throw new Error("bounded process failed"); });
    const target = path.resolve(projectRoot, "tmp/qa/native-demo");

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo", parentDir: "tmp/qa" },
      { runProcess, projectRoot }
    )).rejects.toThrow("bounded process failed");
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(path.dirname(target))).filter((name) => name.startsWith(".dusk-studio-stage-"))).toEqual([]);
  });
});
