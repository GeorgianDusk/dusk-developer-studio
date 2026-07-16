import path from "node:path";

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export interface ScaffoldTargetOptions {
  defaultParent?: string;
  allowedRoots?: string[];
  errorLabel?: string;
}

export interface ScaffoldPlan {
  target: string;
  allowedRoots: string[];
}

export function sanitizeProjectName(projectName: string): string {
  const trimmed = projectName.trim();
  if (
    trimmed !== trimmed.normalize("NFC")
    || !PROJECT_NAME_RE.test(trimmed)
    || trimmed === "."
    || trimmed === ".."
    || trimmed.includes("..")
    || trimmed.endsWith(".")
    || WINDOWS_RESERVED_NAME_RE.test(trimmed)
  ) {
    throw new Error("Project name may only use letters, numbers, dot, underscore, and hyphen.");
  }
  return trimmed;
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniqueRoots(roots: string[]): string[] {
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

function resolveParentDir(defaultParent: string, relativeParentRoot: string, parentDir?: string): string {
  if (!parentDir) return path.resolve(defaultParent);
  if (/^[a-zA-Z]:[^\\/]/.test(parentDir) || /^\\\\/.test(parentDir) || parentDir.includes("\0")) {
    throw new Error("Parent folder must be a normal local absolute path or a relative path inside an approved root.");
  }
  return path.isAbsolute(parentDir) ? path.resolve(parentDir) : path.resolve(relativeParentRoot, parentDir);
}

function isPathInsideAny(roots: string[], target: string): boolean {
  return roots.some((root) => isPathInside(root, target));
}

export function buildScaffoldPlan(workspaceRoot: string, projectName: string, parentDir?: string, options: ScaffoldTargetOptions = {}): ScaffoldPlan {
  const safeName = sanitizeProjectName(projectName);
  const workspace = path.resolve(workspaceRoot);
  const hasCustomDefault = Boolean(options.defaultParent);
  const defaultParent = path.resolve(options.defaultParent ?? path.join(workspace, ".generated"));
  const relativeParentRoot = hasCustomDefault ? defaultParent : workspace;
  const allowedRoots = uniqueRoots([workspace, defaultParent, ...(options.allowedRoots ?? [])]);
  const base = resolveParentDir(defaultParent, relativeParentRoot, parentDir);
  const target = path.resolve(base, safeName);

  if (!isPathInsideAny(allowedRoots, base) || !isPathInsideAny(allowedRoots, target)) {
    throw new Error(`Template target must stay inside ${options.errorLabel ?? "the Studio workspace"}.`);
  }

  return { target, allowedRoots };
}

export function buildScaffoldTarget(workspaceRoot: string, projectName: string, parentDir?: string, options: ScaffoldTargetOptions = {}): string {
  return buildScaffoldPlan(workspaceRoot, projectName, parentDir, options).target;
}
