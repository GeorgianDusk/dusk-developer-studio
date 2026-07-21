import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectNpmTarballBytes } from "./check-comprehensive-validation.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function exactBytesEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyPrepublicationCandidateBytes({
  mainBytes,
  tagBytes,
  mainArtifactDigestSha256,
  expectedIntegrity
}) {
  if (!Buffer.isBuffer(mainBytes) || !Buffer.isBuffer(tagBytes)) {
    throw new TypeError("Pre-publication candidates must be Buffers.");
  }
  if (!SHA256.test(mainArtifactDigestSha256 ?? "") || !INTEGRITY.test(expectedIntegrity ?? "")) {
    throw new Error("Pre-publication digest or integrity input is invalid.");
  }
  const mainSha256 = sha256(mainBytes);
  const tagSha256 = sha256(tagBytes);
  const mainIntegrity = integrity(mainBytes);
  const tagIntegrity = integrity(tagBytes);
  if (mainSha256 !== mainArtifactDigestSha256) {
    throw new Error("Downloaded main-push candidate does not match its GitHub artifact digest.");
  }
  if (!exactBytesEqual(mainBytes, tagBytes) || mainSha256 !== tagSha256) {
    throw new Error("Tag assurance rebuilt different bytes from the reviewed main-push candidate.");
  }
  if (mainIntegrity !== expectedIntegrity || tagIntegrity !== expectedIntegrity) {
    throw new Error("Cross-run candidate integrity differs from tag assurance.");
  }
  return { mainSha256, tagSha256, npmIntegrity: mainIntegrity };
}

function parseArguments(args) {
  const values = {};
  for (const argument of args) {
    const match = /^--([a-z0-9-]+)=(.*)$/u.exec(argument);
    if (!match) throw new Error(`Invalid argument: ${argument}`);
    values[match[1]] = match[2];
  }
  const required = [
    "main",
    "tag",
    "main-artifact-digest-sha256",
    "expected-integrity",
    "expected-inventory-sha256",
    "expected-commit",
    "expected-name",
    "expected-version",
    "github-env"
  ];
  for (const name of required) {
    if (!values[name]) throw new Error(`Missing --${name}.`);
  }
  if (!SHA256.test(values["expected-inventory-sha256"]) || !COMMIT.test(values["expected-commit"])) {
    throw new Error("Expected inventory or commit input is invalid.");
  }
  return values;
}

function readBoundedArchive(archivePath) {
  const absolutePath = path.resolve(archivePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Candidate is not a bounded regular archive: ${archivePath}`);
  }
  return { absolutePath, bytes: fs.readFileSync(absolutePath) };
}

function verifySemanticIdentity(inspected, expected) {
  if (inspected.inventory_verified !== true
      || inspected.inventory_sha256 !== expected.inventorySha256
      || inspected.package_name !== expected.name
      || inspected.package_version !== expected.version
      || inspected.manifest_package !== expected.name
      || inspected.manifest_version !== expected.version
      || inspected.manifest_commit !== expected.commit
      || inspected.manifest_channel !== "npm") {
    throw new Error("Pre-publication candidate semantic identity or inventory is inconsistent.");
  }
}

export function runPrepublicationCandidateBinding(args) {
  const values = parseArguments(args);
  const main = readBoundedArchive(values.main);
  const tag = readBoundedArchive(values.tag);
  const binding = verifyPrepublicationCandidateBytes({
    mainBytes: main.bytes,
    tagBytes: tag.bytes,
    mainArtifactDigestSha256: values["main-artifact-digest-sha256"],
    expectedIntegrity: values["expected-integrity"]
  });
  const expected = {
    inventorySha256: values["expected-inventory-sha256"],
    commit: values["expected-commit"],
    name: values["expected-name"],
    version: values["expected-version"]
  };
  verifySemanticIdentity(inspectNpmTarballBytes(main.bytes), expected);
  verifySemanticIdentity(inspectNpmTarballBytes(tag.bytes), expected);
  fs.appendFileSync(values["github-env"], [
    `TARBALL=${main.absolutePath}`,
    `LOCAL_NPM_INTEGRITY=${binding.npmIntegrity}`,
    `MAIN_ASSURANCE_TARBALL_SHA256=${binding.mainSha256}`,
    `TAG_ASSURANCE_TARBALL_SHA256=${binding.tagSha256}`,
    "PREPUBLICATION_CROSS_RUN_BYTE_MATCH=true",
    ""
  ].join("\n"));
  return binding;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = runPrepublicationCandidateBinding(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ status: "passed", ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
