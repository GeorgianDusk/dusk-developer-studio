import fs from "node:fs";
import path from "node:path";
import { verifyCandidateBoundPhase5Context } from "./phase5-candidate-context.mjs";
import { evaluatePhase5EvidenceOnline } from "./phase5-evidence.mjs";

const root = path.resolve(process.cwd());
const fileArgument = process.argv.find((argument) => argument.startsWith("--file="));
if (!fileArgument) {
  console.error("Usage: node scripts/check-phase5-evidence.mjs --file=<redacted-evidence.json>");
  process.exit(2);
}

try {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN with Actions read access is required for formal Phase 5 verification.");
  const evidencePath = path.resolve(root, fileArgument.slice("--file=".length));
  const policyBytes = fs.readFileSync(path.join(root, "config", "phase5-policy.json"));
  const policy = JSON.parse(policyBytes.toString("utf8"));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const candidateContext = verifyCandidateBoundPhase5Context({ root, evidence, policyBytes });
  const result = await evaluatePhase5EvidenceOnline(policy, evidence, { token, ...candidateContext });
  console.log(JSON.stringify(result, null, 2));
  if (result.decision !== "go") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Phase 5 evidence validation failed.");
  process.exitCode = 1;
}
