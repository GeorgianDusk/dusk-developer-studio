import assert from "node:assert/strict";
import { evaluateMonitorHeartbeat } from "./monitor-heartbeat.mjs";

const now = new Date("2026-07-16T12:00:00Z");
const workflow = { id: 42, path: ".github/workflows/studio-public-staging.yml", state: "active" };
const recentRun = { id: 100, created_at: "2026-07-16T06:23:00Z", status: "completed", conclusion: "success", html_url: "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/100" };

assert.equal(evaluateMonitorHeartbeat({ workflow, runs: [recentRun] }, { now, maxAgeHours: 15 }).status, "passed");
assert.equal(evaluateMonitorHeartbeat({ workflow, runs: [{ ...recentRun, created_at: "2026-07-15T12:00:00Z" }] }, { now, maxAgeHours: 15 }).reason, "scheduled-run-stale");
assert.equal(evaluateMonitorHeartbeat({ workflow: { ...workflow, state: "disabled_manually" }, runs: [recentRun] }, { now }).reason, "workflow-not-active");
assert.equal(evaluateMonitorHeartbeat({ workflow: undefined, runs: [] }, { now }).reason, "workflow-missing");
assert.equal(evaluateMonitorHeartbeat({ workflow, runs: [] }, { now }).reason, "scheduled-run-missing");
assert.equal(evaluateMonitorHeartbeat({ workflow, runs: [{ ...recentRun, created_at: "2026-07-16T13:00:00Z" }] }, { now }).reason, "scheduled-run-is-in-the-future");

console.log("Monitor heartbeat evaluation fixtures passed.");
