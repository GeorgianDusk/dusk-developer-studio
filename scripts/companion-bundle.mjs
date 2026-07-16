import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { cli } from "./companion-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const args = cli(process.argv.slice(2));
  if (!args.out) throw new Error("Usage: node scripts/companion-bundle.mjs --out=<new-directory>");
  const outputRoot = path.resolve(args.out);
  if (fs.existsSync(outputRoot)) throw new Error(`Bundle output already exists: ${outputRoot}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  await build({
    entryPoints: [path.join(productRoot, "packages", "local-runtime", "src", "main.ts")],
    outfile: path.join(outputRoot, "companion.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: false,
    sourcesContent: false,
    legalComments: "none",
    charset: "utf8",
    treeShaking: true,
    logLevel: "silent"
  });
  console.log(JSON.stringify({ status: "bundled", output: path.join(outputRoot, "companion.mjs") }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Companion bundle failed.");
  process.exitCode = 1;
}
