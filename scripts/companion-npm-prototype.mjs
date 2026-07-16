import path from "node:path";
import { buildNpmPrototype } from "./companion-prototype-core.mjs";
import { cli } from "./companion-core.mjs";

try {
  const args = cli(process.argv.slice(2));
  if (!args["windows-release"] || !args["linux-release"] || !args.out) {
    throw new Error("Usage: node scripts/companion-npm-prototype.mjs --windows-release=<verified-release> --linux-release=<verified-release> --out=<new-directory>");
  }
  const result = buildNpmPrototype({ windowsRelease: path.resolve(args["windows-release"]), linuxRelease: path.resolve(args["linux-release"]), outDir: path.resolve(args.out) });
  console.log(JSON.stringify({ status: "built-private-prototype", package: result.packageJson.name, version: result.packageJson.version, output: result.output, tarball: result.tarball, bytes: result.bytes, sha256: result.sha256 }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "npm distribution prototype failed.");
  process.exitCode = 1;
}
