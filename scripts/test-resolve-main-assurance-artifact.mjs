import assert from "node:assert/strict";
import {
  resolveMainAssuranceArtifact,
  selectMainAssuranceArtifact,
  selectMainAssuranceRun
} from "./resolve-main-assurance-artifact.mjs";

const now = new Date("2026-07-21T07:00:00Z");
const requirement = {
  repository: "GeorgianDusk/dusk-developer-studio",
  commit: "a".repeat(40),
  workflowPath: ".github/workflows/studio-npm-package-assurance.yml",
  artifactName: "dusk-developer-studio-1.0.2.tgz"
};
const run = {
  id: 123456,
  head_sha: requirement.commit,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  run_attempt: 1,
  path: requirement.workflowPath,
  url: `https://api.github.com/repos/${requirement.repository}/actions/runs/123456`,
  html_url: `https://github.com/${requirement.repository}/actions/runs/123456`,
  repository: { id: 77, full_name: requirement.repository },
  head_repository: { id: 77, full_name: requirement.repository },
  created_at: "2026-07-21T06:00:00Z",
  run_started_at: "2026-07-21T06:00:01Z",
  updated_at: "2026-07-21T06:10:00Z"
};
const artifact = {
  id: 987654,
  name: requirement.artifactName,
  size_in_bytes: 308455,
  url: `https://api.github.com/repos/${requirement.repository}/actions/artifacts/987654`,
  archive_download_url: `https://api.github.com/repos/${requirement.repository}/actions/artifacts/987654/zip`,
  expired: false,
  digest: `sha256:${"b".repeat(64)}`,
  created_at: "2026-07-21T06:08:00Z",
  updated_at: "2026-07-21T06:08:01Z",
  expires_at: "2026-08-20T06:08:00Z",
  workflow_run: {
    id: run.id,
    repository_id: 77,
    head_repository_id: 77,
    head_branch: "main",
    head_sha: requirement.commit
  }
};

assert.equal(selectMainAssuranceRun({ workflow_runs: [run] }, requirement, now), run);
assert.equal(selectMainAssuranceArtifact({ artifacts: [artifact] }, requirement, run, now), artifact);

const urls = [];
const resolved = await resolveMainAssuranceArtifact(requirement, {
  token: "test-token",
  now,
  fetchImpl: async (url) => {
    urls.push(url);
    return {
      status: 200,
      json: async () => url.includes("/artifacts?")
        ? { artifacts: [artifact] }
        : { workflow_runs: [run] }
    };
  }
});
assert.deepEqual(resolved, {
  run_id: run.id,
  run_url: run.html_url,
  run_attempt: 1,
  artifact_id: artifact.id,
  artifact_name: artifact.name,
  artifact_digest_sha256: "b".repeat(64)
});
assert.match(urls[0], new RegExp(`branch=main&event=push&status=success&head_sha=${requirement.commit}&per_page=100`));
assert.match(urls[1], new RegExp(`/actions/runs/${run.id}/artifacts\\?name=`));

assert.throws(
  () => selectMainAssuranceRun({ workflow_runs: [run, { ...run }] }, requirement, now),
  /found 2/u
);
assert.throws(
  () => selectMainAssuranceRun({ workflow_runs: [{ ...run, run_attempt: 2 }] }, requirement, now),
  /found 0/u
);
assert.throws(
  () => selectMainAssuranceRun({ workflow_runs: [{ ...run, head_sha: "c".repeat(40) }] }, requirement, now),
  /found 0/u
);
assert.throws(
  () => selectMainAssuranceArtifact({ artifacts: [{ ...artifact, digest: "invalid" }] }, requirement, run, now),
  /metadata is invalid/u
);
assert.throws(
  () => selectMainAssuranceArtifact({
    artifacts: [{ ...artifact, workflow_run: { ...artifact.workflow_run, head_sha: "d".repeat(40) } }]
  }, requirement, run, now),
  /found 0/u
);

console.log("Main assurance artifact resolver tests passed.");
