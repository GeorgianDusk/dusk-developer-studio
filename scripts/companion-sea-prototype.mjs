import path from "node:path";
import { buildSeaPrototype } from "./companion-prototype-core.mjs";
import { cli } from "./companion-core.mjs";

try {
  const args = cli(process.argv.slice(2));
  if (!args.release || !args.target || !args.out) {
    throw new Error("Usage: node scripts/companion-sea-prototype.mjs --release=<verified-release> --target=<windows-x64|linux-x64|darwin-arm64> --out=<new-directory>");
  }
  const result = buildSeaPrototype({ releaseDir: path.resolve(args.release), target: args.target, outDir: path.resolve(args.out) });
  console.log(JSON.stringify({ status: "built-private-prototype", target: args.target, output: result.output, executable: result.executable, bytes: result.bytes, sha256: result.sha256 }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Single-executable distribution prototype failed.");
  process.exitCode = 1;
}
