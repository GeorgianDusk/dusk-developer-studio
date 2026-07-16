import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { expectedWorkflowRef } from "./standalone-signing-evidence.mjs";

const TARGETS = ["windows-x64", "linux-x64", "darwin-arm64"];

export function assembleStandaloneSigningEvidence({ policy, records, runId, createdAt = new Date().toISOString() }) {
  const values = TARGETS.map((target) => records[target]);
  if (values.some((record, index) => !record || record.schema_version !== 1 || record.target !== TARGETS[index])) throw new Error("Target evidence does not cover the exact supported target set.");
  const commits = new Set(values.map((record) => record.commit));
  const tags = new Set(values.map((record) => record.release_tag));
  if (commits.size !== 1 || tags.size !== 1) throw new Error("Target evidence does not describe one release candidate.");
  const commit = values[0].commit;
  const releaseTag = values[0].release_tag;
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error("Workflow run id is invalid.");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Evidence creation time is invalid.");
  return {
    schema_version: 2,
    repository: policy.canonical_repository,
    workflow_ref: expectedWorkflowRef(policy, releaseTag),
    run_id: String(runId),
    release_tag: releaseTag,
    commit,
    created_at: createdAt,
    targets: Object.fromEntries(TARGETS.map((target) => [target, records[target]]))
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    if (!args.records || !args.out || !args["run-id"]) throw new Error("Usage: node scripts/assemble-standalone-signing-evidence.mjs --records=<directory> --run-id=<id> --out=<new-json> [--created-at=<ISO-8601>]");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
    const recordsDir = path.resolve(args.records);
    const entries = fs.readdirSync(recordsDir, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || !TARGETS.map((target) => `${target}.json`).includes(entry.name))) throw new Error("Evidence directory contains an unexpected entry.");
    const records = Object.fromEntries(TARGETS.map((target) => [target, JSON.parse(fs.readFileSync(path.join(recordsDir, `${target}.json`), "utf8"))]));
    const evidence = assembleStandaloneSigningEvidence({ policy, records, runId: args["run-id"], createdAt: args["created-at"] ?? new Date().toISOString() });
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "assembled", commit: evidence.commit, release_tag: evidence.release_tag, output: path.resolve(args.out) }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Standalone signing evidence assembly failed."); process.exitCode = 1; }
}
