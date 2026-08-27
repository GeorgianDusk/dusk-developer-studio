import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SupplyChainError,
  buildSbom,
  flattenProductionDependencies,
  summarizePnpmAudit,
  validateDockerfile,
  validatePolicy,
} from "./supply-chain.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = validatePolicy(JSON.parse(fs.readFileSync(path.join(ROOT, "config", "supply-chain-policy.json"), "utf8")));
const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
validateDockerfile(dockerfile, policy);

assert.throws(
  () => validateDockerfile(dockerfile.replace(/@sha256:[0-9a-f]{64}/u, ""), policy),
  SupplyChainError,
  "tag-only base images must fail",
);
assert.throws(
  () => validateDockerfile(dockerfile.replace(/[0-9a-f] AS build/u, "0 AS build"), policy),
  SupplyChainError,
  "digest drift must fail",
);
assert.throws(
  () => validateDockerfile(dockerfile.replace("libcrypto3=3.5.8-r0", "libcrypto3=3.5.7-r0"), policy),
  SupplyChainError,
  "runtime security package drift must fail",
);

const fixture = [
  {
    dependencies: {
      zed: { from: "zed", version: "2.0.0", path: "C:\\secret\\zed" },
      alpha: {
        from: "@scope/alpha",
        version: "1.0.0",
        path: "/private/alpha",
        dependencies: { zed: { from: "zed", version: "2.0.0", path: "/duplicate" } },
      },
      internal: { from: "@dusk/internal", version: "link:../internal", path: "/workspace" },
    },
  },
];
assert.deepEqual(flattenProductionDependencies(fixture), [
  { name: "@scope/alpha", version: "1.0.0" },
  { name: "zed", version: "2.0.0" },
]);
const sbom = buildSbom({
  policy,
  lockBytes: Buffer.from("lock"),
  dockerfileBytes: Buffer.from("docker"),
  packageManifest: { name: "fixture", version: "1.0.0" },
  workspaces: fixture,
});
assert.equal(sbom.bomFormat, "CycloneDX");
assert.equal(sbom.specVersion, "1.6");
assert.equal(sbom.components.length, 2);
assert.match(sbom.components[0].purl, /^pkg:npm\/%40scope\/alpha@1\.0\.0$/u);
assert.doesNotMatch(JSON.stringify(sbom), /secret|private|workspace|duplicate/iu);
assert.deepEqual(
  sbom,
  buildSbom({
    policy,
    lockBytes: Buffer.from("lock"),
    dockerfileBytes: Buffer.from("docker"),
    packageManifest: { name: "fixture", version: "1.0.0" },
    workspaces: [...fixture].reverse(),
  }),
);

const cleanAudit = summarizePnpmAudit(
  { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }, vulnerabilities: {} },
  policy,
  0,
);
assert.equal(cleanAudit.status, "passed");
const blockedAudit = summarizePnpmAudit(
  {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } },
    vulnerabilities: { demo: { severity: "moderate", range: "<2", fixAvailable: true, nodes: ["C:\\secret"] } },
  },
  policy,
  1,
);
assert.equal(blockedAudit.status, "failed_unresolved_vulnerabilities");
assert.equal(blockedAudit.blocking_count, 1);
assert.doesNotMatch(JSON.stringify(blockedAudit), /secret/iu);
assert.throws(
  () => summarizePnpmAudit({ metadata: { vulnerabilities: {} } }, policy, 1),
  SupplyChainError,
);

console.log("Studio supply-chain policy tests passed.");
