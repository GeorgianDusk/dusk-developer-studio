import fs from "node:fs";
import path from "node:path";
import { evaluatePhase5Evidence } from "./phase5-evidence.mjs";

const root = path.resolve(process.cwd());
const fileArgument = process.argv.find((argument) => argument.startsWith("--file="));
if (!fileArgument) {
  console.error("Usage: node scripts/check-phase5-evidence.mjs --file=<redacted-evidence.json>");
  process.exit(2);
}

try {
  const evidencePath = path.resolve(root, fileArgument.slice("--file=".length));
  const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "phase5-policy.json"), "utf8"));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const result = evaluatePhase5Evidence(policy, evidence);
  console.log(JSON.stringify(result, null, 2));
  if (result.decision !== "go") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Phase 5 evidence validation failed.");
  process.exitCode = 1;
}
