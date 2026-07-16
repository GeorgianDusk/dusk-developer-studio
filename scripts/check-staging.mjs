import fs from "node:fs";
import path from "node:path";
import { runStagingSmoke } from "./staging-smoke.mjs";

const root = path.resolve(process.cwd());
const readArgument = (name, fallback) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const baseUrl = readArgument("url");
const expectedEnvironment = readArgument("environment", "staging");
const rpcUrl = readArgument("rpc-url", "https://rpc.testnet.evm.dusk.network");
const output = readArgument("out");
if (!baseUrl) {
  console.error("Usage: node scripts/check-staging.mjs --url=https://approved-host --environment=staging [--out=output/receipt.json]");
  process.exit(2);
}

try {
  const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "phase5-policy.json"), "utf8"));
  const receipt = await runStagingSmoke({ baseUrl, expectedEnvironment, rpcUrl, policy });
  const serialized = JSON.stringify(receipt, null, 2) + "\n";
  if (output) {
    const destination = path.resolve(root, output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, serialized, "utf8");
  }
  console.log(serialized.trimEnd());
  if (receipt.status !== "passed") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Staging smoke failed.");
  process.exitCode = 1;
}
