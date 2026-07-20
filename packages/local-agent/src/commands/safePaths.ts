import path from "node:path";

const PROJECT_NAME_RE = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,79}$/;
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export const RUST_2024_RESERVED_PROJECT_NAMES: ReadonlySet<string> = new Set([
  "abstract", "as", "async", "await", "become", "box", "break", "const", "continue", "crate",
  "do", "dyn", "else", "enum", "extern", "false", "final", "fn", "for", "gen", "if", "impl",
  "in", "let", "loop", "macro", "macro-rules", "match", "mod", "move", "mut", "override", "priv", "pub", "raw",
  "ref", "return", "safe", "self", "static", "struct", "super", "trait", "true", "try", "type",
  "typeof", "union", "unsafe", "unsized", "use", "virtual", "where", "while", "yield"
]);
export const MAX_SCAFFOLD_PATH_LENGTH = 1_024;

export interface ScaffoldTargetOptions {
  defaultParent?: string;
  allowedRoots?: string[];
  errorLabel?: string;
}

export interface ScaffoldPlan {
  target: string;
  allowedRoots: string[];
}

export class ScaffoldPathError extends Error {
  readonly code = "scaffold_parent_outside_root";

  constructor(message = "Parent folder must stay inside the managed project root.") {
    super(message);
    this.name = "ScaffoldPathError";
  }
}

export class ScaffoldProjectNameError extends Error {
  readonly code = "scaffold_project_name_invalid";

  constructor(message = "Project name is not valid for a cross-platform starter folder.") {
    super(message);
    this.name = "ScaffoldProjectNameError";
  }
}

export function sanitizeProjectName(projectName: string): string {
  if (
    projectName !== projectName.trim()
    || projectName !== projectName.normalize("NFC")
    || !PROJECT_NAME_RE.test(projectName)
    || WINDOWS_RESERVED_NAME_RE.test(projectName)
  ) {
    throw new ScaffoldProjectNameError();
  }
  if (RUST_2024_RESERVED_PROJECT_NAMES.has(projectName)) {
    throw new ScaffoldProjectNameError("Project name cannot be a Rust 2024 keyword or reserved word.");
  }
  return projectName;
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
  if (/^[a-zA-Z]:[^\\/]/.test(parentDir) || /^\\\\/.test(parentDir) || /[\0\r\n]/.test(parentDir)) {
    throw new ScaffoldPathError("Parent folder must be a normal local absolute path or a relative path inside the managed project root.");
  }
  return path.isAbsolute(parentDir) ? path.resolve(parentDir) : path.resolve(relativeParentRoot, parentDir);
}

export function assertBoundedScaffoldPath(value: string, label = "Scaffold path"): string {
  if (/[\0\r\n]/.test(value)) {
    throw new ScaffoldPathError(`${label} contains a forbidden control character.`);
  }
  const resolved = path.resolve(value);
  if (resolved.length > MAX_SCAFFOLD_PATH_LENGTH) {
    throw new ScaffoldPathError(`${label} must be ${MAX_SCAFFOLD_PATH_LENGTH.toLocaleString("en-US")} characters or fewer.`);
  }
  return resolved;
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
  const allowedRoots = uniqueRoots([
    ...(hasCustomDefault ? [] : [workspace]),
    defaultParent,
    ...(options.allowedRoots ?? [])
  ]);
  const base = resolveParentDir(defaultParent, relativeParentRoot, parentDir);
  const target = path.resolve(base, safeName);

  assertBoundedScaffoldPath(defaultParent, "Managed scaffold root");
  for (const root of allowedRoots) assertBoundedScaffoldPath(root, "Allowed scaffold root");
  assertBoundedScaffoldPath(base, "Scaffold parent");
  assertBoundedScaffoldPath(target, "Scaffold response path");

  if (!isPathInsideAny(allowedRoots, base) || !isPathInsideAny(allowedRoots, target)) {
    throw new ScaffoldPathError(`Parent folder must stay inside ${options.errorLabel ?? "the Studio workspace"}.`);
  }

  return { target, allowedRoots };
}

export function buildScaffoldTarget(workspaceRoot: string, projectName: string, parentDir?: string, options: ScaffoldTargetOptions = {}): string {
  return buildScaffoldPlan(workspaceRoot, projectName, parentDir, options).target;
}
