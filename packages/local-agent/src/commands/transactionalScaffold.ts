import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPathInside, type ScaffoldPlan } from "./safePaths";

export interface ScaffoldTransactionContext {
  finalTarget: string;
  stageRoot: string;
  stagedTarget: string;
}

export interface ScaffoldTransactionHooks {
  beforePromote?: (context: ScaffoldTransactionContext) => void | Promise<void>;
  heartbeatIntervalMs?: number;
  treeLimits?: Partial<ScaffoldTreeLimits>;
}

export interface ScaffoldTreeLimits {
  maxEntries: number;
  maxBytes: number;
  maxDepth: number;
}

const DEFAULT_TREE_LIMITS: ScaffoldTreeLimits = {
  maxEntries: 10_000,
  maxBytes: 128 * 1024 * 1024,
  maxDepth: 64
};

const ACTIVE_STAGE_ROOTS = new Set<string>();
const LEGACY_STAGE_NAME = /^\.dusk-studio-stage-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OWNED_STAGE_NAME = /^\.dusk-studio-(stage|quarantine)-([1-9][0-9]*)-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const STAGE_CONTAINER_NAME = ".dusk-studio-staging";
const STAGE_OWNER_FILE = ".dusk-studio-owner.json";
const LEGACY_EMPTY_STAGE_GRACE_MS = 30_000;
const OWNED_STAGE_GRACE_MS = 1_000;
const CROSS_SCOPE_LEASE_MS = 15 * 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_STAGE_ENTRIES_INSPECTED = 64;
const MAX_ORPHANS_REMOVED_PER_PASS = 16;
const MAX_LEGACY_PARENT_ENTRIES_INSPECTED = 256;
const CLEANUP_SCAN_BUDGET_MS = 50;
const EXECUTION_SCOPE_FALLBACK_NONCE = randomUUID();

interface DirectoryIdentity {
  realPath: string;
  dev: number;
  ino: number;
}

async function lstatIfExists(target: string) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function nearestExistingAncestor(target: string): Promise<string> {
  let current = path.resolve(target);
  while (!(await lstatIfExists(current))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("No existing filesystem ancestor was found.");
    current = parent;
  }
  return current;
}

async function assertDirectoryNotReparse(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Scaffold paths may not contain symlinks, junctions, reparse points, or non-directory parents.");
  }
}

async function assertExistingSegmentsNotReparse(anchor: string, target: string): Promise<void> {
  const resolvedAnchor = path.resolve(anchor);
  const resolvedTarget = path.resolve(target);
  if (!isPathInside(resolvedAnchor, resolvedTarget)) throw new Error("Scaffold path escaped its approved root.");
  await assertDirectoryNotReparse(resolvedAnchor);
  const relative = path.relative(resolvedAnchor, resolvedTarget);
  if (!relative) return;
  let current = resolvedAnchor;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstatIfExists(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error("Scaffold paths may not contain symlinks, junctions, or reparse points.");
    if (current !== resolvedTarget && !stat.isDirectory()) throw new Error("Scaffold parent path contains a non-directory component.");
  }
}

function selectAllowedRoot(plan: ScaffoldPlan): string {
  const parent = path.dirname(plan.target);
  const candidates = plan.allowedRoots
    .map((root) => path.resolve(root))
    .filter((root) => isPathInside(root, parent))
    .sort((left, right) => right.length - left.length);
  if (!candidates[0]) throw new Error("Scaffold target is outside approved roots.");
  return candidates[0];
}

async function materializeAllowedRoot(root: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const ancestor = await nearestExistingAncestor(resolvedRoot);
  await assertExistingSegmentsNotReparse(ancestor, resolvedRoot);
  await fs.mkdir(resolvedRoot, { recursive: true });
  await assertExistingSegmentsNotReparse(ancestor, resolvedRoot);
  await assertDirectoryNotReparse(resolvedRoot);
  return fs.realpath(resolvedRoot);
}

async function materializeSafeParent(parent: string, allowedRoot: string, canonicalRoot: string): Promise<DirectoryIdentity> {
  await assertExistingSegmentsNotReparse(allowedRoot, parent);
  await fs.mkdir(parent, { recursive: true });
  await assertExistingSegmentsNotReparse(allowedRoot, parent);
  const realPath = await fs.realpath(parent);
  if (!isPathInside(canonicalRoot, realPath)) throw new Error("Scaffold parent resolves outside its approved root.");
  const stat = await fs.stat(parent);
  return { realPath, dev: stat.dev, ino: stat.ino };
}

async function assertParentStable(parent: string, allowedRoot: string, canonicalRoot: string, identity: DirectoryIdentity): Promise<void> {
  await assertExistingSegmentsNotReparse(allowedRoot, parent);
  const realPath = await fs.realpath(parent);
  const stat = await fs.stat(parent);
  if (!isPathInside(canonicalRoot, realPath) || realPath !== identity.realPath) {
    throw new Error("Scaffold parent changed during the operation.");
  }
  if ((identity.ino !== 0 || stat.ino !== 0) && (stat.dev !== identity.dev || stat.ino !== identity.ino)) {
    throw new Error("Scaffold parent identity changed during the operation.");
  }
}

async function assertTargetAbsent(target: string): Promise<void> {
  if (await lstatIfExists(target)) throw new Error("Target path already exists.");
}

async function assertTreeContainsNoReparsePoints(
  root: string,
  limits: ScaffoldTreeLimits,
  state: { entries: number; bytes: number } = { entries: 0, bytes: 0 },
  depth = 0
): Promise<void> {
  if (depth > limits.maxDepth) throw new Error("Staged scaffold exceeded its directory-depth limit.");
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Staged scaffold is not a regular directory.");
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const stat = await fs.lstat(entryPath);
    if (stat.isSymbolicLink()) throw new Error("Staged scaffold contains a symlink, junction, or reparse point.");
    state.entries += 1;
    if (state.entries > limits.maxEntries) throw new Error("Staged scaffold exceeded its entry limit.");
    if (stat.isFile()) {
      state.bytes += stat.size;
      if (state.bytes > limits.maxBytes) throw new Error("Staged scaffold exceeded its byte limit.");
    } else if (stat.isDirectory()) {
      await assertTreeContainsNoReparsePoints(entryPath, limits, state, depth + 1);
    } else {
      throw new Error("Staged scaffold contains an unsupported filesystem entry.");
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readOwnedStageMarker(
  stageRoot: string,
  ownerPid: number,
  stageId: string
): Promise<{ executionScope: string; heartbeatAtMs: number } | undefined> {
  const markerPath = path.join(stageRoot, STAGE_OWNER_FILE);
  const stat = await lstatIfExists(markerPath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > 1_024) return undefined;
  const parsed = JSON.parse(await fs.readFile(markerPath, "utf8")) as Record<string, unknown>;
  if (
    parsed.schemaVersion !== 1
    || parsed.ownerPid !== ownerPid
    || parsed.stageId !== stageId
    || typeof parsed.executionScope !== "string"
    || parsed.executionScope.length > 512
  ) return undefined;
  return { executionScope: parsed.executionScope, heartbeatAtMs: stat.mtimeMs };
}

async function currentExecutionScope(): Promise<string> {
  const parts = [process.platform, os.hostname()];
  if (process.platform === "linux") {
    try {
      parts.push((await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim());
      parts.push(await fs.readlink("/proc/self/ns/pid"));
    } catch {
      parts.push(`linux-scope-unavailable:${EXECUTION_SCOPE_FALLBACK_NONCE}`);
    }
  }
  return JSON.stringify(parts);
}

async function orphanCandidateNames(stageContainer: string): Promise<string[]> {
  const candidates: string[] = [];
  const directory = await fs.opendir(stageContainer);
  let inspected = 0;
  for await (const entry of directory) {
    inspected += 1;
    if (inspected > MAX_STAGE_ENTRIES_INSPECTED) {
      throw new Error("Studio staging recovery found more than 64 entries. Inspect the reserved .dusk-studio-staging directory before retrying; no project files were changed.");
    }
    if (OWNED_STAGE_NAME.test(entry.name)) candidates.push(entry.name);
  }
  return candidates.sort();
}

function leaseIsRecoverable(
  marker: { executionScope: string; heartbeatAtMs: number },
  ownerPid: number,
  executionScope: string,
  now: number
): boolean {
  const leaseAge = now - marker.heartbeatAtMs;
  if (marker.executionScope === executionScope) {
    return leaseAge >= OWNED_STAGE_GRACE_MS && !processIsAlive(ownerPid);
  }
  return leaseAge >= CROSS_SCOPE_LEASE_MS;
}

async function cleanupLegacyEmptyCandidate(
  stageRoot: string,
  parent: string,
  allowedRoot: string,
  canonicalRoot: string,
  identity: DirectoryIdentity,
  now: number
): Promise<void> {
  try {
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    const stat = await fs.lstat(stageRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    const realStage = await fs.realpath(stageRoot);
    if (!isPathInside(identity.realPath, realStage)) return;
    if (now - stat.mtimeMs < LEGACY_EMPTY_STAGE_GRACE_MS) return;
    if ((await fs.readdir(stageRoot)).length !== 0) return;
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    await fs.rmdir(stageRoot).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
    });
  } catch {
    // An ambiguous legacy directory is left untouched.
  }
}

async function cleanupLegacyEmptyStages(
  parent: string,
  allowedRoot: string,
  canonicalRoot: string,
  identity: DirectoryIdentity
): Promise<void> {
  const now = Date.now();
  const directory = await fs.opendir(parent);
  const startedAt = Date.now();
  let inspected = 0;
  for await (const entry of directory) {
    if (inspected >= MAX_LEGACY_PARENT_ENTRIES_INSPECTED || Date.now() - startedAt >= CLEANUP_SCAN_BUDGET_MS) break;
    inspected += 1;
    if (LEGACY_STAGE_NAME.test(entry.name)) {
      await cleanupLegacyEmptyCandidate(path.join(parent, entry.name), parent, allowedRoot, canonicalRoot, identity, now);
    }
  }
}

async function materializeStageContainer(parent: string, identity: DirectoryIdentity): Promise<{ path: string; identity: DirectoryIdentity }> {
  const stageContainer = path.join(parent, STAGE_CONTAINER_NAME);
  const existing = await lstatIfExists(stageContainer);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error("The reserved Studio staging path is not a regular directory.");
  }
  await fs.mkdir(stageContainer, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await fs.lstat(stageContainer);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("The reserved Studio staging path is not a regular directory.");
  const realPath = await fs.realpath(stageContainer);
  if (!isPathInside(identity.realPath, realPath)) throw new Error("The reserved Studio staging path escaped its parent.");
  return { path: realPath, identity: { realPath, dev: stat.dev, ino: stat.ino } };
}

async function cleanupOwnedStages(
  stageContainer: string,
  containerIdentity: DirectoryIdentity,
  limits: ScaffoldTreeLimits,
  executionScope: string
): Promise<void> {
  const now = Date.now();
  const aggregateState = { entries: 0, bytes: 0 };
  let removed = 0;
  for (const entryName of await orphanCandidateNames(stageContainer)) {
    if (removed >= MAX_ORPHANS_REMOVED_PER_PASS) break;
    const ownedMatch = OWNED_STAGE_NAME.exec(entryName);
    if (!ownedMatch) continue;
    const stageRoot = path.join(stageContainer, entryName);
    if (ACTIVE_STAGE_ROOTS.has(path.resolve(stageRoot))) continue;
    try {
      const stat = await fs.lstat(stageRoot);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      const realStage = await fs.realpath(stageRoot);
      if (!isPathInside(containerIdentity.realPath, realStage)) continue;
      const ownerPid = Number.parseInt(ownedMatch[2], 10);
      const stageId = ownedMatch[3];
      if (!Number.isSafeInteger(ownerPid)) continue;
      const marker = await readOwnedStageMarker(stageRoot, ownerPid, stageId);
      if (!marker) continue;
      if (!leaseIsRecoverable(marker, ownerPid, executionScope, now)) continue;
      const quarantineRoot = ownedMatch[1] === "quarantine"
        ? stageRoot
        : path.join(stageContainer, `.dusk-studio-quarantine-${ownerPid}-${stageId}`);
      if (quarantineRoot !== stageRoot) await fs.rename(stageRoot, quarantineRoot);
      const revalidatedMarker = await readOwnedStageMarker(quarantineRoot, ownerPid, stageId);
      if (!revalidatedMarker || !leaseIsRecoverable(revalidatedMarker, ownerPid, executionScope, Date.now())) {
        if (quarantineRoot !== stageRoot) {
          await fs.rename(quarantineRoot, stageRoot).catch(() => undefined);
        }
        continue;
      }
      const containerStat = await fs.stat(stageContainer);
      const realContainer = await fs.realpath(stageContainer);
      if (
        realContainer !== containerIdentity.realPath
        || ((containerIdentity.ino !== 0 || containerStat.ino !== 0)
          && (containerStat.dev !== containerIdentity.dev || containerStat.ino !== containerIdentity.ino))
      ) throw new Error("The Studio staging container changed during cleanup.");
      await assertTreeContainsNoReparsePoints(quarantineRoot, limits, aggregateState);
      await fs.rm(quarantineRoot, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A candidate that changes, exceeds aggregate bounds, or cannot be proved safe remains quarantined.
    }
  }
}

async function cleanupStage(stageRoot: string, parent: string, allowedRoot: string, canonicalRoot: string, identity: DirectoryIdentity): Promise<void> {
  try {
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    const stageStat = await lstatIfExists(stageRoot);
    if (!stageStat) return;
    if (stageStat.isSymbolicLink() || !stageStat.isDirectory()) return;
    const realStage = await fs.realpath(stageRoot);
    if (!isPathInside(identity.realPath, realStage)) return;
    await fs.rm(stageRoot, { recursive: true, force: true });
  } catch {
    // Do not follow an untrusted path merely to clean up. A later recovery pass may quarantine it.
  }
}

export async function runScaffoldTransaction(
  plan: ScaffoldPlan,
  populate: (context: ScaffoldTransactionContext) => void | Promise<void>,
  hooks: ScaffoldTransactionHooks = {}
): Promise<string> {
  const finalTarget = path.resolve(plan.target);
  const projectName = path.basename(finalTarget);
  const parent = path.dirname(finalTarget);
  const allowedRoot = selectAllowedRoot(plan);
  const canonicalRoot = await materializeAllowedRoot(allowedRoot);
  const identity = await materializeSafeParent(parent, allowedRoot, canonicalRoot);
  await assertTargetAbsent(finalTarget);

  const treeLimits = { ...DEFAULT_TREE_LIMITS, ...hooks.treeLimits };
  const heartbeatIntervalMs = hooks.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  if (treeLimits.maxEntries <= 0 || treeLimits.maxBytes <= 0 || treeLimits.maxDepth <= 0 || heartbeatIntervalMs <= 0) {
    throw new Error("Scaffold tree limits must be positive.");
  }
  await cleanupLegacyEmptyStages(parent, allowedRoot, canonicalRoot, identity);
  const executionScope = await currentExecutionScope();
  const stageContainer = await materializeStageContainer(parent, identity);
  await cleanupOwnedStages(stageContainer.path, stageContainer.identity, treeLimits, executionScope);
  const stageId = randomUUID();
  const stageRoot = path.join(stageContainer.path, `.dusk-studio-stage-${process.pid}-${stageId}`);
  const stagedTarget = path.join(stageRoot, projectName);
  const context = { finalTarget, stageRoot, stagedTarget };
  const markerPath = path.join(stageRoot, STAGE_OWNER_FILE);
  let stageCreated = false;
  let activeStageRegistered = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let heartbeatWrite = Promise.resolve();
  let heartbeatWriteInFlight = false;
  let heartbeatFailure: Error | undefined;
  const marker = () => JSON.stringify({
    schemaVersion: 1,
    ownerPid: process.pid,
    stageId,
    executionScope
  });
  async function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    await heartbeatWrite;
  }
  function currentHeartbeatFailure(): Error | undefined {
    return heartbeatFailure;
  }

  try {
    await fs.mkdir(stageRoot, { recursive: false, mode: 0o700 });
    stageCreated = true;
    await fs.writeFile(markerPath, marker(), { encoding: "utf8", flag: "wx", mode: 0o600 });
    ACTIVE_STAGE_ROOTS.add(path.resolve(stageRoot));
    activeStageRegistered = true;
    heartbeatTimer = setInterval(() => {
      if (heartbeatWriteInFlight || heartbeatFailure) return;
      heartbeatWriteInFlight = true;
      const now = new Date();
      heartbeatWrite = fs.utimes(markerPath, now, now)
        .catch((error) => {
          heartbeatFailure = error instanceof Error ? error : new Error("The Studio staging lease could not be refreshed.");
        })
        .finally(() => {
          heartbeatWriteInFlight = false;
        });
    }, heartbeatIntervalMs);
    heartbeatTimer.unref();
    await populate(context);
    const populationHeartbeatFailure = currentHeartbeatFailure();
    if (populationHeartbeatFailure) throw new Error(`The Studio staging lease could not be refreshed; scaffold promotion was aborted. ${populationHeartbeatFailure.message}`);
    await assertTreeContainsNoReparsePoints(stagedTarget, treeLimits);
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    await assertTargetAbsent(finalTarget);
    await hooks.beforePromote?.(context);
    await stopHeartbeat();
    const promotionHeartbeatFailure = currentHeartbeatFailure();
    if (promotionHeartbeatFailure) throw new Error(`The Studio staging lease could not be refreshed; scaffold promotion was aborted. ${promotionHeartbeatFailure.message}`);
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    await assertTargetAbsent(finalTarget);
    await fs.rename(stagedTarget, finalTarget);
    await assertTreeContainsNoReparsePoints(finalTarget, treeLimits);
    const realTarget = await fs.realpath(finalTarget);
    if (!isPathInside(canonicalRoot, realTarget)) throw new Error("Promoted scaffold resolved outside its approved root.");
    await fs.rm(markerPath, { force: true });
    await fs.rmdir(stageRoot).catch(() => undefined);
    return finalTarget;
  } catch (error) {
    await stopHeartbeat();
    if (stageCreated) await cleanupStage(stageRoot, parent, allowedRoot, canonicalRoot, identity);
    throw error;
  } finally {
    await stopHeartbeat();
    if (activeStageRegistered) ACTIVE_STAGE_ROOTS.delete(path.resolve(stageRoot));
  }
}
