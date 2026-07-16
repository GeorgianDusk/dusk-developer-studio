import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReleaseManifest } from "./release-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { manifest, destination } = writeReleaseManifest(root);
console.log(`Release manifest ${manifest.version} (${manifest.commit.slice(0, 8)}) wrote ${manifest.artifacts.length} artifact digests to ${destination}.`);
