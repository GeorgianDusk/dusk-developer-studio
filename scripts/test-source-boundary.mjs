import assert from "node:assert/strict";
import { classifyTrackedPath } from "./check-source-boundary.mjs";

assert.equal(classifyTrackedPath("apps/studio/src/app/App.tsx").ok, true);
assert.equal(classifyTrackedPath("packages/template/.env.example").ok, true);
assert.equal(classifyTrackedPath(".agents/provider/SKILL.md").ok, false);
assert.equal(classifyTrackedPath("packages/demo/node_modules/x/index.js").ok, false);
assert.equal(classifyTrackedPath("packages/demo/out/result.json").ok, false);
assert.equal(classifyTrackedPath("nested/.env.local").ok, false);
assert.equal(classifyTrackedPath("nested/signing.key").ok, false);
assert.equal(classifyTrackedPath("apps/studio/tsconfig.tsbuildinfo").ok, false);
console.log("Source-boundary quarantine fixtures passed.");
