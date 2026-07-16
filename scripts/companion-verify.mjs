import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli, verifyRelease } from "./companion-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const args = cli(process.argv.slice(2));
  if (!args.release) throw new Error("Usage: node scripts/companion-verify.mjs --release=<directory> [--publication] [--trusted-public-key=<pem>] [--skip-runtime-execution]");
  const result = verifyRelease({ productRoot, releaseDir: args.release, publication: args.publication === true || args.publication === "true", trustedPublicKey: args["trusted-public-key"], executeRuntime: args["skip-runtime-execution"] !== true });
  console.log(JSON.stringify({ status: "verified", target: result.manifest.target, version: result.manifest.version, commit: result.manifest.commit, signing_status: result.manifest.signing_status, files: result.fileCount, bytes: result.totalBytes, fingerprint_sha256: result.fingerprint }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "Companion release verification failed."); process.exitCode = 1; }
