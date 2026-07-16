import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const studioRoot = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(studioRoot, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(productRoot, "package.json"), "utf8")) as { version: string };
const artifactChannels = new Set(["hosted", "portable", "source-dev"]);

function readArtifactChannel(): string {
  const channel = process.env.DUSK_STUDIO_ARTIFACT_CHANNEL?.trim().toLowerCase() || "hosted";
  if (!artifactChannels.has(channel)) {
    throw new Error(`DUSK_STUDIO_ARTIFACT_CHANNEL must be one of: ${[...artifactChannels].join(", ")}.`);
  }
  return channel;
}

function readCommit(): string {
  const override = process.env.DUSK_STUDIO_RELEASE_COMMIT?.trim();
  if (override) return override.toLowerCase();
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: productRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", "."], { cwd: productRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    return dirty ? `${commit}-dirty` : commit;
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __DUSK_STUDIO_VERSION__: JSON.stringify(packageJson.version),
    __DUSK_STUDIO_COMMIT__: JSON.stringify(readCommit()),
    __DUSK_STUDIO_ARTIFACT_CHANNEL__: JSON.stringify(readArtifactChannel())
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  }
});
