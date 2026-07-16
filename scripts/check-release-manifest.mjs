import fs from "node:fs";
import path from "node:path";
import { validateReleaseManifest } from "./release-metadata.mjs";

try {
  const root = path.resolve(process.cwd());
  const manifestPath = path.join(root, "apps", "studio", "dist", "release-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const result = validateReleaseManifest(root, manifest);
  console.log(`Release parity verified for ${result.version} (${result.commit.slice(0, 8)}) across ${result.artifactCount} artifacts.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release manifest validation failed.");
  process.exitCode = 1;
}
