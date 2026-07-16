import path from "node:path";
import { artifactFingerprint } from "./assurance-metadata.mjs";

console.log(artifactFingerprint(path.resolve(process.cwd())));
