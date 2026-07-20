import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  scaffoldDuskDsForge,
  type ScaffoldCompletionReceipt
} from "../commands/scaffoldDuskDsForge";
import { duskDsCounterForgeTemplateIdentity } from "../../../templates/src/duskDsCounterForge";

const templateRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../templates/duskds-counter-forge"
);
const roots: string[] = [];

async function makeTempRoot(prefix = "dusk-studio-"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function copyTemplate(): Promise<string> {
  const parent = await makeTempRoot("dusk-template-fixture-");
  const destination = path.join(parent, "template");
  await fs.cp(templateRoot, destination, { recursive: true, force: false });
  return destination;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("DuskDS reviewed-template scaffold", () => {
  it("materializes the packaged template transactionally without invoking an external generator", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const result = await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo", parentDir: "tmp/qa" },
      { projectRoot, templateRoot }
    );

    expect(result).toMatchObject({
      ok: true,
      template: duskDsCounterForgeTemplateIdentity.templateId,
      templateSource: duskDsCounterForgeTemplateIdentity.upstreamRepository,
      templateRevision: duskDsCounterForgeTemplateIdentity.upstreamRevision,
      templateLockSha256: duskDsCounterForgeTemplateIdentity.templateLockSha256,
      projectRoot,
      rustToolchain: "1.94.0",
      structureVerified: true,
      recovered: false
    });
    expect(result.path).toBe(path.resolve(projectRoot, "tmp/qa", "native-demo"));
    expect(result.files).toEqual(expect.arrayContaining([
      "Cargo.lock",
      "Cargo.toml",
      "Makefile",
      "PROVENANCE.md",
      "rust-toolchain.toml",
      "src/lib.rs",
      "tests/contract.rs"
    ]));
    await expect(fs.readFile(path.join(result.path, "rust-toolchain.toml"), "utf8"))
      .resolves.toContain('channel = "1.94.0"');
    await expect(fs.readFile(path.join(result.path, "Cargo.toml"), "utf8"))
      .resolves.toContain('name = "native-demo"');
    expect((await fs.readdir(path.dirname(result.path)))
      .filter((name) => name.startsWith(".dusk-studio-stage-"))).toEqual([]);
  });

  it("does not scaffold into an existing target, including an empty directory", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const target = path.resolve(projectRoot, "tmp/qa/native-demo");
    await fs.mkdir(target, { recursive: true });

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo", parentDir: "tmp/qa" },
      { projectRoot, templateRoot }
    )).rejects.toThrow("not created by a completed action");
  });

  it("recovers an exact content-verified target without writing it again", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const completedScaffoldReceipts = new Map();
    const created = await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot, completedScaffoldReceipts }
    );
    const before = await fs.readFile(path.join(created.path, "Cargo.lock"));

    const recovered = await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot, completedScaffoldReceipts }
    );

    expect(recovered).toMatchObject({ recovered: true, structureVerified: true });
    await expect(fs.readFile(path.join(recovered.path, "Cargo.lock"))).resolves.toEqual(before);
  });

  it("fails closed when a same-runtime retry finds starter content tampering", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const completedScaffoldReceipts = new Map();
    const created = await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot, completedScaffoldReceipts }
    );
    await fs.writeFile(path.join(created.path, "src", "lib.rs"), "pub fn tampered() {}\n");

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot, completedScaffoldReceipts }
    )).rejects.toThrow("no longer matches the completed Local Studio action receipt");
  });

  it("rejects a lookalike target without a same-runtime completed-action receipt", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot }
    );

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot, completedScaffoldReceipts: new Map() }
    )).rejects.toThrow("not created by a completed action in this running Local Studio");
  });

  it("bounds same-runtime completion receipts and evicts the oldest entry", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const receipts = new Map<string, ScaffoldCompletionReceipt>();
    const receipt: ScaffoldCompletionReceipt = {
      files: ["Cargo.toml", "rust-toolchain.toml"],
      rustToolchain: "1.94.0",
      templateRevision: duskDsCounterForgeTemplateIdentity.upstreamRevision,
      templateLockSha256: duskDsCounterForgeTemplateIdentity.templateLockSha256,
      contentSha256: "0".repeat(64)
    };
    for (let index = 0; index < 64; index += 1) receipts.set(`old-${index}`, receipt);

    await scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "bounded-demo" },
      { projectRoot, templateRoot, completedScaffoldReceipts: receipts }
    );

    expect(receipts).toHaveLength(64);
    expect(receipts.has("old-0")).toBe(false);
    expect(receipts.has("old-63")).toBe(true);
  });

  it("rejects an incomplete or drifted template before promotion and removes its stage", async () => {
    const workspaceRoot = await makeTempRoot();
    const projectRoot = await makeTempRoot();
    const incomplete = await copyTemplate();
    await fs.rm(path.join(incomplete, "Cargo.toml"));
    const target = path.resolve(projectRoot, "native-demo");

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot, templateRoot: incomplete }
    )).rejects.toThrow("file inventory does not match");
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(projectRoot)).filter((name) => name.startsWith(".dusk-studio-stage-")))
      .toEqual([]);

    const drifted = await copyTemplate();
    await fs.appendFile(path.join(drifted, "Cargo.lock"), "\n# drift\n");
    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "drift-demo" },
      { projectRoot, templateRoot: drifted }
    )).rejects.toThrow("Cargo.lock does not match the reviewed dependency resolution");
    await expect(fs.lstat(path.resolve(projectRoot, "drift-demo"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects over-bound roots and full target paths before reading template content", async () => {
    const workspaceRoot = await makeTempRoot();
    const overlongRoot = path.resolve(workspaceRoot, "r".repeat(1_100));
    const missingTemplate = path.join(workspaceRoot, "does-not-exist");

    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo" },
      { projectRoot: overlongRoot, templateRoot: missingTemplate }
    )).rejects.toThrow("1,024 characters or fewer");
    await expect(scaffoldDuskDsForge(
      { cwd: workspaceRoot, projectName: "native-demo", parentDir: "p".repeat(1_100) },
      { projectRoot: workspaceRoot, templateRoot: missingTemplate }
    )).rejects.toThrow("1,024 characters or fewer");
  });
});
