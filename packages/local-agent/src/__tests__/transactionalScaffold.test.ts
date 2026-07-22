// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildScaffoldPlan } from "../commands/safePaths";
import { runScaffoldTransaction } from "../commands/transactionalScaffold";

const tempRoots: string[] = [];
const LEGACY_STAGE_TEST_RE = /^\.dusk-studio-stage-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function makeTempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function createDirectoryLink(target: string, link: string): Promise<void> {
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}

async function executionScopeForTest() {
  const parts = [process.platform, os.hostname()];
  if (process.platform === "linux") {
    try {
      parts.push((await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim());
      parts.push(await fs.readlink("/proc/self/ns/pid"));
    } catch {
      parts.push("linux-scope-unavailable");
    }
  }
  return JSON.stringify(parts);
}

async function createOwnedStage(
  parent: string,
  ownerPid: number,
  stageId: string,
  entries: string[] = [],
  options: { ageMs?: number; executionScope?: string } = {}
) {
  const stageContainer = path.join(parent, ".dusk-studio-staging");
  await fs.mkdir(stageContainer, { recursive: true });
  const stageRoot = path.join(stageContainer, `.dusk-studio-stage-${ownerPid}-${stageId}`);
  await fs.mkdir(stageRoot, { recursive: true });
  const markerPath = path.join(stageRoot, ".dusk-studio-owner.json");
  await fs.writeFile(markerPath, JSON.stringify({
    schemaVersion: 1,
    ownerPid,
    stageId,
    executionScope: options.executionScope ?? await executionScopeForTest()
  }));
  const heartbeat = new Date(Date.now() - (options.ageMs ?? 2_000));
  await fs.utimes(markerPath, heartbeat, heartbeat);
  for (const entry of entries) await fs.writeFile(path.join(stageRoot, entry), entry);
  return stageRoot;
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

  it("removes an old empty legacy stage before starting a new transaction", async () => {
    const workspace = await makeTempRoot("dusk-transaction-legacy-stage-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const legacyStage = path.join(parent, ".dusk-studio-stage-8ceab7b7-d974-442f-a08e-4fe41f7fae55");
    await fs.mkdir(legacyStage);
    const old = new Date(Date.now() - 31_000);
    await fs.utimes(legacyStage, old, old);

    await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    });

    await expect(fs.lstat(legacyStage)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a bounded stage owned by a process that is no longer alive", async () => {
    const workspace = await makeTempRoot("dusk-transaction-dead-stage-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const deadPid = 2147483646;
    const deadStage = await createOwnedStage(parent, deadPid, "8ceab7b7-d974-442f-a08e-4fe41f7fae55", ["partial.txt"]);
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === deadPid) throw Object.assign(new Error("not running"), { code: "ESRCH" });
      return true;
    });

    try {
      await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
        await fs.mkdir(stagedTarget, { recursive: true });
        await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
      });
    } finally {
      kill.mockRestore();
    }

    await expect(fs.lstat(deadStage)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove a stage whose owner process is still alive", async () => {
    const workspace = await makeTempRoot("dusk-transaction-live-stage-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const liveStage = await createOwnedStage(
      parent,
      process.pid,
      "8ceab7b7-d974-442f-a08e-4fe41f7fae55",
      ["active.txt"]
    );

    await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    });

    await expect(fs.readFile(path.join(liveStage, "active.txt"), "utf8")).resolves.toBe("active.txt");
  });

  it("preserves a fresh lease from another execution scope even when its PID is absent locally", async () => {
    const workspace = await makeTempRoot("dusk-transaction-foreign-lease-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const foreignPid = 2147483642;
    const foreignStage = await createOwnedStage(
      parent,
      foreignPid,
      "8ceab7b7-d974-442f-a08e-4fe41f7fae55",
      ["active.txt"],
      { executionScope: "foreign-pid-namespace" }
    );
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === foreignPid) throw Object.assign(new Error("not running here"), { code: "ESRCH" });
      return true;
    });

    try {
      await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
        await fs.mkdir(stagedTarget, { recursive: true });
        await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
      });
    } finally {
      kill.mockRestore();
    }

    await expect(fs.readFile(path.join(foreignStage, "active.txt"), "utf8")).resolves.toBe("active.txt");
  });

  it("restores a foreign stage whose lease is renewed while cleanup quarantines it", async () => {
    const workspace = await makeTempRoot("dusk-transaction-renewed-lease-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const foreignStage = await createOwnedStage(
      parent,
      2147483640,
      "8ceab7b7-d974-442f-a08e-4fe41f7fae55",
      ["active.txt"],
      { ageMs: 16 * 60_000, executionScope: "foreign-pid-namespace" }
    );
    const originalRename = fs.rename.bind(fs);
    const rename = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      await originalRename(source, destination);
      if (path.resolve(source.toString()) === path.resolve(foreignStage)) {
        const markerPath = path.join(destination.toString(), ".dusk-studio-owner.json");
        const renewed = new Date();
        await fs.utimes(markerPath, renewed, renewed);
      }
    });

    try {
      await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
        await fs.mkdir(stagedTarget, { recursive: true });
        await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
      });
    } finally {
      rename.mockRestore();
    }

    await expect(fs.readFile(path.join(foreignStage, "active.txt"), "utf8")).resolves.toBe("active.txt");
    const entries = await fs.readdir(path.join(parent, ".dusk-studio-staging"));
    expect(entries.some((entry) => entry.startsWith(".dusk-studio-quarantine-"))).toBe(false);
  });

  it("preserves recent, non-empty, and malformed legacy-like directories", async () => {
    const workspace = await makeTempRoot("dusk-transaction-legacy-preserve-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const recent = path.join(parent, ".dusk-studio-stage-8ceab7b7-d974-442f-a08e-4fe41f7fae55");
    const nonEmpty = path.join(parent, ".dusk-studio-stage-9ceab7b7-d974-442f-a08e-4fe41f7fae55");
    const malformed = path.join(parent, ".dusk-studio-stage-not-owned");
    await Promise.all([fs.mkdir(recent), fs.mkdir(nonEmpty), fs.mkdir(malformed)]);
    await fs.writeFile(path.join(nonEmpty, "user.txt"), "preserve");
    const old = new Date(Date.now() - 31_000);
    await fs.utimes(nonEmpty, old, old);
    await fs.utimes(malformed, old, old);

    await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    });

    expect((await fs.lstat(recent)).isDirectory()).toBe(true);
    await expect(fs.readFile(path.join(nonEmpty, "user.txt"), "utf8")).resolves.toBe("preserve");
    expect((await fs.lstat(malformed)).isDirectory()).toBe(true);
  });

  it("quarantines but does not delete a dead-owned stage containing a reparse point", async () => {
    const workspace = await makeTempRoot("dusk-transaction-orphan-reparse-");
    const outside = await makeTempRoot("dusk-transaction-orphan-reparse-outside-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const deadPid = 2147483645;
    const stageId = "8ceab7b7-d974-442f-a08e-4fe41f7fae55";
    const deadStage = await createOwnedStage(parent, deadPid, stageId);
    await fs.writeFile(path.join(outside, "sentinel.txt"), "outside");
    await createDirectoryLink(outside, path.join(deadStage, "linked"));
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === deadPid) throw Object.assign(new Error("not running"), { code: "ESRCH" });
      return true;
    });

    try {
      await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
        await fs.mkdir(stagedTarget, { recursive: true });
        await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
      });
    } finally {
      kill.mockRestore();
    }

    await expect(fs.lstat(deadStage)).rejects.toMatchObject({ code: "ENOENT" });
    const quarantine = path.join(parent, ".dusk-studio-staging", `.dusk-studio-quarantine-${deadPid}-${stageId}`);
    expect((await fs.lstat(quarantine)).isDirectory()).toBe(true);
    await expect(fs.readFile(path.join(outside, "sentinel.txt"), "utf8")).resolves.toBe("outside");
  });

  it("bounds legacy cleanup work per transaction", async () => {
    const workspace = await makeTempRoot("dusk-transaction-orphan-count-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const old = new Date(Date.now() - 31_000);
    for (let index = 0; index < 260; index += 1) {
      const stage = path.join(parent, `.dusk-studio-stage-8ceab7b7-d974-442f-a08e-${index.toString(16).padStart(12, "0")}`);
      await fs.mkdir(stage);
      await fs.utimes(stage, old, old);
    }

    await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    });

    const remaining = (await fs.readdir(parent)).filter((name) => LEGACY_STAGE_TEST_RE.test(name));
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(260);
  });

  it("applies tree limits across all orphan candidates in one cleanup pass", async () => {
    const workspace = await makeTempRoot("dusk-transaction-orphan-aggregate-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    const deadPids = new Set([2147483643, 2147483644]);
    for (const [index, deadPid] of [...deadPids].entries()) {
      await createOwnedStage(
        parent,
        deadPid,
        `8ceab7b7-d974-442f-a08e-${index.toString(16).padStart(12, "0")}`,
        ["one", "two", "three", "four", "five"]
      );
    }
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (deadPids.has(pid)) throw Object.assign(new Error("not running"), { code: "ESRCH" });
      return true;
    });

    try {
      await runScaffoldTransaction(plan, async ({ stagedTarget }) => {
        await fs.mkdir(stagedTarget, { recursive: true });
        await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
      }, { treeLimits: { maxEntries: 8 } });
    } finally {
      kill.mockRestore();
    }

    const quarantines = (await fs.readdir(path.join(parent, ".dusk-studio-staging")))
      .filter((name) => name.startsWith(".dusk-studio-quarantine-"));
    expect(quarantines).toHaveLength(1);
  });

  it("fails closed when staging entries exceed the bounded scan", async () => {
    const workspace = await makeTempRoot("dusk-transaction-orphan-starvation-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    await fs.mkdir(parent, { recursive: true });
    for (let index = 0; index < 64; index += 1) {
      await createOwnedStage(
        parent,
        1_000 + index,
        `8ceab7b7-d974-442f-a08e-${index.toString(16).padStart(12, "0")}`,
        ["active.txt"],
        { executionScope: "foreign-pid-namespace" }
      );
    }
    const deadPid = 2147483641;
    const recoverable = await createOwnedStage(
      parent,
      deadPid,
      "9ceab7b7-d974-442f-a08e-ffffffffffff",
      ["partial.txt"]
    );
    await expect(runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    })).rejects.toThrow(/more than 64 entries/);
    expect((await fs.lstat(recoverable)).isDirectory()).toBe(true);
  });

  it("cleans the empty stage when writing its owner marker fails", async () => {
    const workspace = await makeTempRoot("dusk-transaction-marker-failure-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const parent = path.dirname(plan.target);
    const writeFile = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("marker write failed"));

    try {
      await expect(runScaffoldTransaction(plan, async () => undefined)).rejects.toThrow("marker write failed");
    } finally {
      writeFile.mockRestore();
    }

    await expect(fs.readdir(path.join(parent, ".dusk-studio-staging"))).resolves.toEqual([]);
  });

  it("keeps the immutable owner marker valid when a heartbeat update fails", async () => {
    const workspace = await makeTempRoot("dusk-transaction-heartbeat-failure-");
    const plan = buildScaffoldPlan(workspace, "demo");
    const utimes = vi.spyOn(fs, "utimes").mockRejectedValueOnce(new Error("heartbeat failed"));
    let marker: Record<string, unknown> | undefined;

    try {
      await expect(runScaffoldTransaction(plan, async ({ stageRoot, stagedTarget }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        marker = JSON.parse(await fs.readFile(path.join(stageRoot, ".dusk-studio-owner.json"), "utf8")) as Record<string, unknown>;
        await fs.mkdir(stagedTarget, { recursive: true });
        await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
      }, { heartbeatIntervalMs: 5 })).rejects.toThrow(/lease could not be refreshed/);
    } finally {
      utimes.mockRestore();
    }

    expect(marker).toMatchObject({ schemaVersion: 1, ownerPid: process.pid });
    expect(marker).not.toHaveProperty("heartbeatAt");
    await expect(fs.lstat(plan.target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readdir(path.join(path.dirname(plan.target), ".dusk-studio-staging"))).resolves.toEqual([]);
  });

  it("aborts before promotion when an in-flight heartbeat fails during the promotion hook", async () => {
    const workspace = await makeTempRoot("dusk-transaction-deferred-heartbeat-failure-");
    const plan = buildScaffoldPlan(workspace, "demo");
    let rejectHeartbeat: ((error: Error) => void) | undefined;
    let reportHeartbeatStarted: (() => void) | undefined;
    const heartbeatStarted = new Promise<void>((resolve) => { reportHeartbeatStarted = resolve; });
    let releasePromotionHook: (() => void) | undefined;
    const promotionHookGate = new Promise<void>((resolve) => { releasePromotionHook = resolve; });
    let reportPromotionHookStarted: (() => void) | undefined;
    const promotionHookStarted = new Promise<void>((resolve) => { reportPromotionHookStarted = resolve; });
    const utimes = vi.spyOn(fs, "utimes").mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectHeartbeat = reject;
      reportHeartbeatStarted?.();
    }));

    const transaction = runScaffoldTransaction(plan, async ({ stagedTarget }) => {
      await fs.mkdir(stagedTarget, { recursive: true });
      await fs.writeFile(path.join(stagedTarget, "complete.txt"), "complete");
    }, {
      heartbeatIntervalMs: 5,
      beforePromote: async () => {
        reportPromotionHookStarted?.();
        await promotionHookGate;
      }
    });

    try {
      await promotionHookStarted;
      await heartbeatStarted;
      rejectHeartbeat?.(new Error("deferred heartbeat failed"));
      releasePromotionHook?.();
      await expect(transaction).rejects.toThrow(/lease could not be refreshed/);
    } finally {
      releasePromotionHook?.();
      utimes.mockRestore();
    }

    await expect(fs.lstat(plan.target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readdir(path.join(path.dirname(plan.target), ".dusk-studio-staging"))).resolves.toEqual([]);
  }, 20_000);

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
