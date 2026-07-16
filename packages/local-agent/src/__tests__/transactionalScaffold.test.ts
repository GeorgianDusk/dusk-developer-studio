// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildScaffoldPlan } from "../commands/safePaths";
import { runScaffoldTransaction } from "../commands/transactionalScaffold";

const tempRoots: string[] = [];

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function createDirectoryLink(target: string, link: string): Promise<void> {
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("transactional scaffold boundary", () => {
  it("rejects a junction or symlink component before population", async () => {
    const workspace = await makeTempRoot("dusk-transaction-workspace-");
    const outside = await makeTempRoot("dusk-transaction-outside-");
    await createDirectoryLink(outside, path.join(workspace, "linked"));
    const populate = vi.fn();
    const plan = buildScaffoldPlan(workspace, "demo", "linked");

    await expect(runScaffoldTransaction(plan, populate)).rejects.toThrow(/symlink|junction|reparse/i);
    expect(populate).not.toHaveBeenCalled();
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it("leaves no visible target after an injected partial population failure", async () => {
    const workspace = await makeTempRoot("dusk-transaction-partial-");
    for (const failAfter of [1, 2, 3]) {
      const projectName = `demo-${failAfter}`;
      const plan = buildScaffoldPlan(workspace, projectName);
      await expect(runScaffoldTransaction(plan, async ({ stagedTarget }) => {
        await fs.mkdir(stagedTarget, { recursive: true });
        for (let index = 1; index <= 3; index += 1) {
          await fs.writeFile(path.join(stagedTarget, `entry-${index}.txt`), "partial");
          if (index === failAfter) throw new Error(`injected copy failure ${failAfter}`);
        }
      })).rejects.toThrow(`injected copy failure ${failAfter}`);
      await expect(fs.lstat(plan.target)).rejects.toMatchObject({ code: "ENOENT" });
      const parentEntries = await fs.readdir(path.dirname(plan.target));
      expect(parentEntries.filter((name) => name.startsWith(".dusk-studio-stage-"))).toEqual([]);
    }
  });

  it("rejects a staged tree containing a junction or symlink", async () => {
    const workspace = await makeTempRoot("dusk-transaction-tree-");
    const outside = await makeTempRoot("dusk-transaction-tree-outside-");
    const plan = buildScaffoldPlan(workspace, "demo");
    await expect(runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await createDirectoryLink(outside, path.join(stagedTarget, "linked"));
    })).rejects.toThrow(/symlink|junction|reparse/i);
    await expect(fs.lstat(plan.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects staged output that exceeds its filesystem resource bound", async () => {
    const workspace = await makeTempRoot("dusk-transaction-limit-");
    const plan = buildScaffoldPlan(workspace, "demo");
    await expect(runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "too-large.txt"), "01234567890");
    }, { treeLimits: { maxBytes: 10 } })).rejects.toThrow("byte limit");
    await expect(fs.lstat(plan.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates the final target after the staging work and catches a swap", async () => {
    const workspace = await makeTempRoot("dusk-transaction-swap-");
    const outside = await makeTempRoot("dusk-transaction-swap-outside-");
    const plan = buildScaffoldPlan(workspace, "demo");
    await expect(runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    }, {
      beforePromote: async ({ finalTarget }) => createDirectoryLink(outside, finalTarget)
    })).rejects.toThrow("already exists");

    expect((await fs.lstat(plan.target)).isSymbolicLink()).toBe(true);
    await expect(fs.readdir(outside)).resolves.toEqual([]);
    const parentEntries = await fs.readdir(path.dirname(plan.target));
    expect(parentEntries.filter((name) => name.startsWith(".dusk-studio-stage-"))).toEqual([]);
  });

  it("rejects existing empty and non-empty targets instead of merging into them", async () => {
    const workspace = await makeTempRoot("dusk-transaction-existing-");
    for (const projectName of ["empty", "non-empty"]) {
      const plan = buildScaffoldPlan(workspace, projectName);
      await fs.mkdir(plan.target, { recursive: true });
      if (projectName === "non-empty") await fs.writeFile(path.join(plan.target, "existing.txt"), "existing");
      const populate = vi.fn();
      await expect(runScaffoldTransaction(plan, populate)).rejects.toThrow("already exists");
      expect(populate).not.toHaveBeenCalled();
    }
  });

  it("allows only one winner for concurrent requests to the same target", async () => {
    const workspace = await makeTempRoot("dusk-transaction-concurrent-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const populate = async ({ stagedTarget }: { stagedTarget: string }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    };
    const results = await Promise.allSettled([
      runScaffoldTransaction(plan, populate),
      runScaffoldTransaction(plan, populate)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(fs.readFile(path.join(plan.target, "complete.txt"), "utf8")).resolves.toBe("complete");
    const parentEntries = await fs.readdir(path.dirname(plan.target));
    expect(parentEntries.filter((name) => name.startsWith(".dusk-studio-stage-"))).toEqual([]);
  });
});
