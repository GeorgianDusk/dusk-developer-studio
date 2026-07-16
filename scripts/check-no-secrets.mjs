import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(["node_modules", ".pnpm-store", "dist", "coverage", "playwright-report", "test-results", ".git", ".agents", ".vite", "out", "cache", "broadcast", "tmp", ".generated", ".local-agent"]);
const IGNORE_SUFFIXES = [".tsbuildinfo"];
const SECRET_PATTERNS = [
  { name: "private key assignment", pattern: /(?:PRIVATE_KEY|private_key|mnemonic|seed phrase|seeder)\s*[:=]\s*[^\s]+/i },
  { name: "private-key-like hex", pattern: /0x[a-fA-F0-9]{64}/ },
  { name: "api secret assignment", pattern: /(?:API_KEY|api_key|SECRET|secret)\s*[:=]\s*[^\s]+/ }
];
const ALLOWED_FILES = new Set([
  "docs/security/threat-model.md",
  "README.md",
  "AGENTS.md",
  "packages/core/src/__tests__/core.test.ts",
  "packages/templates/foundry-counter-dusk-evm/README.md",
  "packages/templates/foundry-counter-dusk-evm/AGENTS.md",
  "packages/templates/foundry-counter-dusk-evm/.env.example"
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORE_DIRS.has(entry.name) ? [] : walk(fullPath);
    }
    return [fullPath];
  });
}

const findings = [];
for (const file of walk(ROOT)) {
  const relative = path.relative(ROOT, file).replace(/\\/g, "/");
  if (IGNORE_SUFFIXES.some((suffix) => relative.endsWith(suffix))) continue;
  if (ALLOWED_FILES.has(relative)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const check of SECRET_PATTERNS) {
    if (check.pattern.test(text)) {
      findings.push(`${relative}: ${check.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secret-like values found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("No secret-like values found.");
