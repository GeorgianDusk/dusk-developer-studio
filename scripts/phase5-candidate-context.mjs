import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const COMMIT_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export const PHASE5_EVALUATOR_PATHS = Object.freeze([
  "config/phase5-policy.json",
  "scripts/check-phase5-evidence.mjs",
  "scripts/phase5-candidate-context.mjs",
  "scripts/phase5-evidence.mjs",
  "scripts/github-actions-provenance.mjs"
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function defaultGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function verifyCandidateBoundPhase5Context({
  root,
  evidence,
  policyBytes,
  git = (args) => defaultGit(root, args)
}) {
  const candidate = evidence?.candidate ?? {};
  const policySha256 = sha256(policyBytes);
  if (!COMMIT_RE.test(candidate.commit ?? "")
      || candidate.evaluator_commit !== candidate.commit
      || !SHA256_RE.test(candidate.policy_sha256 ?? "")
      || candidate.policy_sha256 !== policySha256) {
    throw new Error("Phase 5 evidence is not bound to the exact local policy bytes and evaluator commit.");
  }

  const head = git(["rev-parse", "HEAD"]);
  if (head !== candidate.commit) {
    throw new Error("Formal Phase 5 verification must run from the exact candidate commit.");
  }
  const trackedChanges = git(["status", "--porcelain=v1", "--untracked-files=no"]);
  if (trackedChanges) {
    throw new Error("Formal Phase 5 verification requires a clean tracked candidate checkout.");
  }
  for (const file of PHASE5_EVALUATOR_PATHS) {
    git(["cat-file", "-e", `${head}:${file}`]);
  }

  return {
    evaluatorCommit: head,
    policySha256
  };
}
