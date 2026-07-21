import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { verifyPrepublicationCandidateBytes } from "./prepublication-candidate-binding.mjs";

const mainBytes = Buffer.from("reviewed-main-push-candidate", "utf8");
const mainArtifactDigestSha256 = createHash("sha256").update(mainBytes).digest("hex");
const expectedIntegrity = `sha512-${createHash("sha512").update(mainBytes).digest("base64")}`;

assert.deepEqual(
  verifyPrepublicationCandidateBytes({
    mainBytes,
    tagBytes: Buffer.from(mainBytes),
    mainArtifactDigestSha256,
    expectedIntegrity
  }),
  {
    mainSha256: mainArtifactDigestSha256,
    tagSha256: mainArtifactDigestSha256,
    npmIntegrity: expectedIntegrity
  }
);

assert.throws(
  () => verifyPrepublicationCandidateBytes({
    mainBytes,
    tagBytes: Buffer.from("different-tag-rebuild", "utf8"),
    mainArtifactDigestSha256,
    expectedIntegrity
  }),
  /rebuilt different bytes/u
);

assert.throws(
  () => verifyPrepublicationCandidateBytes({
    mainBytes,
    tagBytes: Buffer.from(mainBytes),
    mainArtifactDigestSha256: "0".repeat(64),
    expectedIntegrity
  }),
  /does not match its GitHub artifact digest/u
);

console.log("Pre-publication candidate binding tests passed.");
