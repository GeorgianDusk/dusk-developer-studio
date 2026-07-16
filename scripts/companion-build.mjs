import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease, cli } from "./companion-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const args = cli(process.argv.slice(2));
  if (!args.target || !args.out || !args["launcher-bundle"] || (!args["runtime-root"] && !args["runtime-archive"])) throw new Error("Usage: node scripts/companion-build.mjs --target=<windows-x64|linux-x64|darwin-arm64> --out=<new-directory> --launcher-bundle=<directory> (--runtime-root=<directory> --runtime-root-verified | --runtime-archive=<archive>) [--commit=<40-sha>] [--release-mode=<internal-rc|publication>] [--signing-private-key=<pem>] [--source-date-epoch=<seconds>]");
  const result = buildRelease({ productRoot, target: args.target, outDir: args.out, launcherBundle: args["launcher-bundle"], runtimeRoot: args["runtime-root"], runtimeRootVerified: args["runtime-root-verified"] === true || args["runtime-root-verified"] === "true", runtimeArchive: args["runtime-archive"], studioDist: args["studio-dist"], templateRoot: args["template-root"], commit: args.commit, version: args.version, releaseMode: args["release-mode"], signingPrivateKey: args["signing-private-key"], sourceDateEpoch: args["source-date-epoch"], executeRuntime: args["skip-runtime-execution"] !== true });
  console.log(JSON.stringify({ status: "built", target: result.manifest.target, version: result.manifest.version, commit: result.manifest.commit, signing_status: result.manifest.signing_status, output: result.outDir, fingerprint_sha256: result.fingerprint, archive: "not-created-deterministic-directory-output" }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "Companion release build failed."); process.exitCode = 1; }
