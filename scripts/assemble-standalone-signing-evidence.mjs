import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cli } from "./companion-core.mjs";
import { evaluateStandaloneSigningEvidence, expectedWorkflowRef } from "./standalone-signing-evidence.mjs";

const TARGETS = ["windows-x64", "linux-x64", "darwin-arm64"];

export function assembleStandaloneSigningEvidence({
  policy, records, runId, runAttempt, runActor, approvalReferenceUrl, createdAt = new Date().toISOString()
}) {
  const values = TARGETS.map((target) => records[target]);
  if (values.some((record, index) => !record || record.schema_version !== 3 || record.target !== TARGETS[index])) throw new Error("Target evidence does not cover the exact supported target set.");
  const commits = new Set(values.map((record) => record.commit));
  const tags = new Set(values.map((record) => record.release_tag));
  if (commits.size !== 1 || tags.size !== 1) throw new Error("Target evidence does not describe one release candidate.");
  const commit = values[0].commit;
  const releaseTag = values[0].release_tag;
  if (!/^[1-9][0-9]*$/.test(String(runId))) throw new Error("Workflow run id is invalid.");
  if (!/^[1-9][0-9]*$/.test(String(runAttempt))) throw new Error("Workflow run attempt is invalid.");
  if (!/^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(runActor ?? "")) throw new Error("Workflow actor is invalid.");
  let approvalUrl;
  try { approvalUrl = new URL(approvalReferenceUrl); } catch { throw new Error("Approval reference URL is invalid."); }
  if (approvalUrl.protocol !== "https:" || approvalUrl.hostname !== "github.com" || approvalUrl.username || approvalUrl.password
      || !approvalUrl.pathname.startsWith(`/${policy.canonical_repository}/`)) throw new Error("Approval reference URL is not canonical.");
  if (values.some((record) => record.repository !== policy.canonical_repository
      || record.workflow_ref !== expectedWorkflowRef(policy, record.release_tag)
      || record.run_id !== String(runId) || record.run_attempt !== String(runAttempt) || record.run_actor !== runActor)) {
    throw new Error("Target evidence does not belong to this exact workflow run and actor.");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt)) || new Date(Date.parse(createdAt)).toISOString().replace(".000Z", "Z") !== createdAt.replace(".000Z", "Z")) {
    throw new Error("Evidence creation time is invalid.");
  }
  const evidence = {
    schema_version: 3,
    repository: policy.canonical_repository,
    workflow_ref: expectedWorkflowRef(policy, releaseTag),
    run_id: String(runId),
    run_attempt: String(runAttempt),
    run_actor: runActor,
    approval_reference_url: approvalReferenceUrl,
    release_tag: releaseTag,
    commit,
    created_at: createdAt,
    targets: Object.fromEntries(TARGETS.map((target) => [target, records[target]]))
  };
  const acceptance = evaluateStandaloneSigningEvidence(policy, evidence);
  if (acceptance.decision !== "accepted") throw new Error(`Target evidence packet was rejected: ${acceptance.blockers.join(" ")}`);
  return evidence;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    if (!args.records || !args.out || !args["run-id"] || !args["run-attempt"] || !args["run-actor"] || !args["approval-reference-url"]) {
      throw new Error("Usage: node scripts/assemble-standalone-signing-evidence.mjs --records=<directory> --run-id=<id> --run-attempt=<id> --run-actor=<github:login> --approval-reference-url=<canonical-github-url> --out=<new-json> [--created-at=<ISO-8601>]");
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
    const recordsDir = path.resolve(args.records);
    const entries = fs.readdirSync(recordsDir, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || !TARGETS.map((target) => `${target}.json`).includes(entry.name))) throw new Error("Evidence directory contains an unexpected entry.");
    const records = Object.fromEntries(TARGETS.map((target) => [target, JSON.parse(fs.readFileSync(path.join(recordsDir, `${target}.json`), "utf8"))]));
    const evidence = assembleStandaloneSigningEvidence({
      policy,
      records,
      runId: args["run-id"],
      runAttempt: args["run-attempt"],
      runActor: args["run-actor"],
      approvalReferenceUrl: args["approval-reference-url"],
      createdAt: args["created-at"] ?? new Date().toISOString()
    });
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "assembled", commit: evidence.commit, release_tag: evidence.release_tag, output: path.resolve(args.out) }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Standalone signing evidence assembly failed."); process.exitCode = 1; }
}
