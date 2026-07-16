import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_SEGMENTS = new Set([
  ".agents", ".codex", ".generated", ".local-agent", "node_modules", "dist", "coverage",
  "playwright-report", "test-results", "tmp", "out", "cache", "broadcast", "__pycache__"
]);
const SENSITIVE_FILE_RE = /(^|\/)(\.env(?:\..+)?|[^/]+\.(?:pem|key|p12|pfx))$/i;

export function classifyTrackedPath(repoPath) {
  const normalized = repoPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  const forbiddenSegment = segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment));
  if (forbiddenSegment) return { ok: false, reason: `forbidden generated/provider segment ${forbiddenSegment}` };
  if (SENSITIVE_FILE_RE.test(normalized) && !normalized.endsWith(".env.example")) return { ok: false, reason: "sensitive filename" };
  if (normalized.endsWith(".tsbuildinfo")) return { ok: false, reason: "generated compiler state" };
  return { ok: true };
}

function countProviderMetadata(root) {
  const providerRoot = path.join(root, ".agents");
  if (!fs.existsSync(providerRoot)) return 0;
  let count = 0;
  const pending = [providerRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Quarantined provider tree contains a symlink or reparse point.");
    if (!stat.isDirectory()) { count += 1; continue; }
    for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
  }
  return count;
}

export function checkSourceBoundary(root) {
  const gitRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", shell: false, windowsHide: true });
  if (gitRootResult.status !== 0) throw new Error("Source-boundary validation requires the canonical Git checkout.");
  const gitRoot = gitRootResult.stdout.trim();
  const productPrefix = path.relative(gitRoot, root).replace(/\\/g, "/");
  const pathspec = productPrefix || ".";
  const trackedResult = spawnSync("git", ["ls-files", "-z", "--", pathspec], { cwd: gitRoot, encoding: "utf8", shell: false, windowsHide: true });
  if (trackedResult.status !== 0) throw new Error("Could not read the canonical tracked source list.");
  const tracked = trackedResult.stdout.split("\0").filter(Boolean);
  const violations = tracked
    .map((repoPath) => ({ repoPath, result: classifyTrackedPath(productPrefix ? repoPath.slice(productPrefix.length + 1) : repoPath) }))
    .filter((entry) => !entry.result.ok);
  if (tracked.length === 0) violations.push({ repoPath: productPrefix || ".", result: { reason: "canonical product source is not tracked" } });
  if (violations.length > 0) throw new Error("Source-boundary violations found:\n" + violations.map((violation) => `- ${violation.repoPath}: ${violation.result.reason}`).join("\n"));
  return { trackedFiles: tracked.length, providerFiles: countProviderMetadata(root) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = checkSourceBoundary(process.cwd());
    console.log(`Source boundary verified for ${result.trackedFiles} tracked product files; quarantined provider metadata files: ${result.providerFiles}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Source-boundary validation failed.");
    process.exitCode = 1;
  }
}
