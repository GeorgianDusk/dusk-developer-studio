import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isPathInside, type ScaffoldPlan } from "./safePaths";

export interface ScaffoldTransactionContext {
  finalTarget: string;
  stageRoot: string;
  stagedTarget: string;
}

export interface ScaffoldTransactionHooks {
  beforePromote?: (context: ScaffoldTransactionContext) => void | Promise<void>;
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

  const stageRoot = path.join(parent, `.dusk-studio-stage-${randomUUID()}`);
  const stagedTarget = path.join(stageRoot, projectName);
  const context = { finalTarget, stageRoot, stagedTarget };
  const treeLimits = { ...DEFAULT_TREE_LIMITS, ...hooks.treeLimits };
  if (treeLimits.maxEntries <= 0 || treeLimits.maxBytes <= 0 || treeLimits.maxDepth <= 0) {
    throw new Error("Scaffold tree limits must be positive.");
  }
  await fs.mkdir(stageRoot, { recursive: false, mode: 0o700 });

  try {
    await populate(context);
    await assertTreeContainsNoReparsePoints(stagedTarget, treeLimits);
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    await assertTargetAbsent(finalTarget);
    await hooks.beforePromote?.(context);
    await assertParentStable(parent, allowedRoot, canonicalRoot, identity);
    await assertTargetAbsent(finalTarget);
    await fs.rename(stagedTarget, finalTarget);
    await assertTreeContainsNoReparsePoints(finalTarget, treeLimits);
    const realTarget = await fs.realpath(finalTarget);
    if (!isPathInside(canonicalRoot, realTarget)) throw new Error("Promoted scaffold resolved outside its approved root.");
    await fs.rmdir(stageRoot).catch(() => undefined);
    return finalTarget;
  } catch (error) {
    await cleanupStage(stageRoot, parent, allowedRoot, canonicalRoot, identity);
    throw error;
  }
}
