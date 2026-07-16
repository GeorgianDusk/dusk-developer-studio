import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WORKFLOW_PATH = ".github/workflows/studio-public-staging.yml";
const MAX_RESPONSE_BYTES = 1_000_000;

function failed(reason, details = {}) {
  return { schema_version: 1, status: "failed", reason, ...details };
}

export function evaluateMonitorHeartbeat({ workflow, runs }, options = {}) {
  const now = options.now ?? new Date();
  const maxAgeHours = options.maxAgeHours ?? 15;
  const workflowPath = options.workflowPath ?? DEFAULT_WORKFLOW_PATH;
  const checkedAt = now.toISOString();
  const maxAgeSeconds = Math.round(maxAgeHours * 60 * 60);
  const common = { workflow_path: workflowPath, checked_at: checkedAt, max_age_seconds: maxAgeSeconds };

  if (!workflow || workflow.path !== workflowPath) return failed("workflow-missing", common);
  if (workflow.state !== "active") return failed("workflow-not-active", { ...common, workflow_id: workflow.id ?? null, workflow_state: workflow.state ?? "unknown" });
  const latest = Array.isArray(runs) ? runs[0] : undefined;
  if (!latest) return failed("scheduled-run-missing", { ...common, workflow_id: workflow.id });
  const createdAt = Date.parse(latest.created_at);
  if (!Number.isFinite(createdAt)) return failed("scheduled-run-time-invalid", { ...common, workflow_id: workflow.id, last_run_id: latest.id ?? null });
  const ageSeconds = Math.floor((now.getTime() - createdAt) / 1_000);
  const observed = {
    ...common,
    workflow_id: workflow.id,
    workflow_state: workflow.state,
    last_run_id: latest.id ?? null,
    last_run_url: typeof latest.html_url === "string" ? latest.html_url : null,
    last_run_status: latest.status ?? "unknown",
    last_run_conclusion: latest.conclusion ?? null,
    last_run_created_at: new Date(createdAt).toISOString(),
    age_seconds: ageSeconds
  };
  if (ageSeconds < -300) return failed("scheduled-run-is-in-the-future", observed);
  if (ageSeconds > maxAgeSeconds) return failed("scheduled-run-stale", observed);
  return { schema_version: 1, status: "passed", ...observed };
}

async function githubJson(apiUrl, token, endpoint) {
  const response = await globalThis.fetch(`${apiUrl}${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "DuskStudioMonitorWatchdog/1.0",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    redirect: "error"
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("GitHub API response exceeded its bound.");
  return JSON.parse(text);
}

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function outputPath(value) {
  const outputRoot = path.resolve(process.cwd(), "output");
  const resolved = path.resolve(process.cwd(), value);
  if (resolved !== outputRoot && !resolved.startsWith(`${outputRoot}${path.sep}`)) throw new Error("Heartbeat receipt must stay under output/.");
  return resolved;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  const apiUrl = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
  const workflowPath = argument("workflow-path", DEFAULT_WORKFLOW_PATH);
  const maxAgeHours = Number(argument("max-age-hours", "15"));
  const receiptPath = outputPath(argument("out", "output/monitor-heartbeat-receipt.json"));
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) throw new Error("GitHub repository and token are required.");
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 72) throw new Error("Heartbeat maximum age must be between 0 and 72 hours.");

  let receipt;
  try {
    const workflows = await githubJson(apiUrl, token, `/repos/${repository}/actions/workflows?per_page=100`);
    const workflow = Array.isArray(workflows.workflows) ? workflows.workflows.find((item) => item.path === workflowPath) : undefined;
    const runResult = workflow
      ? await githubJson(apiUrl, token, `/repos/${repository}/actions/workflows/${workflow.id}/runs?event=schedule&per_page=1`)
      : { workflow_runs: [] };
    receipt = evaluateMonitorHeartbeat({ workflow, runs: runResult.workflow_runs }, { maxAgeHours, workflowPath });
  } catch {
    receipt = failed("github-api-unavailable", { workflow_path: workflowPath, checked_at: new Date().toISOString(), max_age_seconds: Math.round(maxAgeHours * 60 * 60) });
  }

  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Monitor heartbeat ${receipt.status}: ${receipt.reason ?? "recent scheduled run observed"}.`);
  if (receipt.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
