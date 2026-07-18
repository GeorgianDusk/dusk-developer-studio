import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { createCandidatePackageManifest } from "./standalone-candidate-package-manifest.mjs";
import {
  createStandaloneCandidateZip,
  safeExtractStandaloneCandidateZip,
  STANDALONE_ZIP_LIMITS
} from "./standalone-safe-zip-extract.mjs";

const UTF8_FLAG = 0x0800;
const DIRECTORY_TYPE = 0o040000;
const REGULAR_TYPE = 0o100000;
const SYMLINK_TYPE = 0o120000;
const BLOCK_TYPE = 0o060000;
const commit = "a".repeat(40);

const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < 256; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  CRC_TABLE[value] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixture(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function zipBytes(file, records, options = {}) {
  const localParts = [];
  const centralParts = [];
  let localCursor = 0;
  for (const source of records) {
    const data = Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data ?? "");
    const directory = source.directory ?? String(source.name).endsWith("/");
    const method = source.method ?? (directory ? 0 : 8);
    const flags = (source.flags ?? UTF8_FLAG) | (source.descriptor ? 0x0008 : 0);
    const name = Buffer.isBuffer(source.name) ? source.name : Buffer.from(source.name, "utf8");
    const localName = Buffer.isBuffer(source.localName)
      ? source.localName
      : Buffer.from(source.localName ?? source.name, "utf8");
    const compressed = source.compressed ?? (method === 8 ? deflateRawSync(data, { level: 9 }) : data);
    const expectedCrc = source.crc ?? crc32(data);
    const compressedSize = source.compressedSize ?? compressed.length;
    const uncompressedSize = source.uncompressedSize ?? data.length;
    const centralExtra = source.centralExtra ?? Buffer.alloc(0);
    const localExtra = source.localExtra ?? centralExtra;
    const versionNeeded = source.versionNeeded ?? (method === 8 || source.descriptor ? 20 : 10);
    const versionMadeBy = ((source.host ?? 0) << 8) | 20;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(versionNeeded, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(source.descriptor ? 0 : expectedCrc, 14);
    local.writeUInt32LE(source.descriptor ? 0 : compressedSize, 18);
    local.writeUInt32LE(source.descriptor ? 0 : uncompressedSize, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = source.descriptor && !source.omitDescriptor
      ? descriptorBytes(expectedCrc, compressedSize, uncompressedSize, source.signedDescriptor !== false)
      : Buffer.alloc(0);
    const gap = source.gapAfter ?? Buffer.alloc(0);
    localParts.push(local, localName, localExtra, compressed, descriptor, gap);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(versionMadeBy, 4);
    central.writeUInt16LE(versionNeeded, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(expectedCrc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt16LE(0, 32);
    const mode = source.mode ?? (directory ? DIRECTORY_TYPE | 0o755 : REGULAR_TYPE | 0o644);
    const external = source.externalAttributes
      ?? ((source.host === 3 || source.host === 19) ? ((mode << 16) >>> 0) : (directory ? 0x10 : 0));
    central.writeUInt32LE(external >>> 0, 38);
    central.writeUInt32LE(source.centralLocalOffset ?? localCursor, 42);
    centralParts.push(central, name, centralExtra);
    localCursor += local.length + localName.length + localExtra.length
      + compressed.length + descriptor.length + gap.length;
  }
  const localBytes = Buffer.concat(localParts);
  const centralBytes = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.disk ?? 0, 4);
  eocd.writeUInt16LE(options.centralDisk ?? 0, 6);
  eocd.writeUInt16LE(options.diskEntries ?? records.length, 8);
  eocd.writeUInt16LE(options.totalEntries ?? records.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(options.centralOffset ?? localBytes.length, 16);
  const bytes = Buffer.concat([
    options.prepend ?? Buffer.alloc(0),
    localBytes,
    centralBytes,
    eocd,
    options.trailing ?? Buffer.alloc(0)
  ]);
  fs.writeFileSync(file, bytes);
}

function descriptorBytes(crc, compressedSize, uncompressedSize, signed) {
  const descriptor = Buffer.alloc(signed ? 16 : 12);
  const base = signed ? 4 : 0;
  if (signed) descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, base);
  descriptor.writeUInt32LE(compressedSize, base + 4);
  descriptor.writeUInt32LE(uncompressedSize, base + 8);
  return descriptor;
}

function centralMetadata(file) {
  const bytes = fs.readFileSync(file);
  const eocd = bytes.length - 22;
  const entries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const records = [];
  for (let index = 0; index < entries; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    records.push({
      name: bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      host: bytes.readUInt16LE(offset + 4) >>> 8,
      mode: bytes.readUInt32LE(offset + 38) >>> 16
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return records;
}

function exactStage(ephemeral, target) {
  const stage = path.join(ephemeral, `stage-${target}`);
  const version = "1.2.3";
  const definitions = targetDefinitions(target);
  const launcherFiles = {};
  for (const [key, name] of Object.entries(definitions.launchers)) {
    const data = Buffer.from(`${target}-${key}-mode-bound-launcher\n`);
    launcherFiles[key] = { name, data };
    writeFixture(path.join(stage, ...name.split("/")), data);
  }
  const suffix = target === "windows-x64" ? ".exe" : "";
  const unsignedLaunchers = {
    safe: {
      mode: "safe",
      name: `dusk-developer-studio-safe-${version}-${target}-internal-rc${suffix}`,
      bytes: 101,
      sha256: sha256(`${target}-unsigned-safe`)
    },
    local_actions: {
      mode: "local-actions",
      name: `dusk-developer-studio-local-actions-${version}-${target}-internal-rc${suffix}`,
      bytes: 102,
      sha256: sha256(`${target}-unsigned-local-actions`)
    }
  };
  const unsignedAssetIndexSha256 = sha256(Buffer.from(`${JSON.stringify([
    unsignedLaunchers.safe, unsignedLaunchers.local_actions
  ], null, 2)}\n`));
  const receipt = {
    schema_version: 3,
    status: "internal-nonpublication-rc",
    channel: "node-sea-in-process",
    target,
    version,
    commit,
    embedded_release_fingerprint_sha256: "1".repeat(64),
    embedded_runtime_version: "24.18.0",
    contains_second_embedded_runtime: false,
    externalized_runtime: {
      path: target === "windows-x64" ? "runtime/node.exe" : "runtime/node",
      bytes_removed_from_bundle: 1,
      sha256: "2".repeat(64)
    },
    embedded_file_count: 1,
    embedded_release_bundle_bytes: 1,
    embedded_release_bundle_sha256: "3".repeat(64),
    postject_version: "1.0.0-alpha.6",
    platform_signature_status: target === "darwin-arm64" ? "adhoc-development-only" : "unsigned",
    embedded_payload_trust: {
      portable_manifest_signing_status: "unsigned-rc",
      standalone_platform_trust: "not-established",
      publication_eligible: false
    },
    launchers: unsignedLaunchers,
    unsigned_asset_index_sha256: unsignedAssetIndexSha256,
    executable: unsignedLaunchers.safe.name,
    executable_sha256: unsignedLaunchers.safe.sha256,
    executable_bytes: unsignedLaunchers.safe.bytes
  };
  writeJson(path.join(stage, "evidence", "prototype-receipt.json"), receipt);
  for (const [name, value] of Object.entries(definitions.extraFiles)) {
    writeFixture(path.join(stage, ...name.split("/")), value);
  }
  const index = {
    schema_version: 1,
    target,
    version,
    commit,
    unsigned_asset_index_sha256: unsignedAssetIndexSha256,
    launchers: {
      safe: {
        mode: "safe",
        name: launcherFiles.safe.name,
        bytes: launcherFiles.safe.data.length,
        sha256: sha256(launcherFiles.safe.data)
      },
      local_actions: {
        mode: "local-actions",
        name: launcherFiles.local_actions.name,
        bytes: launcherFiles.local_actions.data.length,
        sha256: sha256(launcherFiles.local_actions.data)
      }
    },
    ...(definitions.attestations ? { attestations: definitions.attestations } : {})
  };
  writeJson(path.join(stage, "signed-launcher-index.json"), index);
  const manifest = createCandidatePackageManifest({
    root: stage,
    target,
    buildReceipt: path.join(stage, "evidence", "prototype-receipt.json"),
    signedLauncherIndex: path.join(stage, "signed-launcher-index.json")
  });
  writeJson(path.join(stage, "candidate-package-manifest.json"), manifest);
  return {
    stage,
    launchers: new Set(Object.values(definitions.launchers)),
    descriptor: target === "darwin-arm64",
    host: target === "windows-x64" ? 0 : target === "darwin-arm64" ? 19 : 3
  };
}

function targetDefinitions(target) {
  if (target === "linux-x64") {
    const safeBundle = Buffer.from('{"mediaType":"application/vnd.dev.sigstore.bundle+json;version=0.1"}\n');
    const actionsBundle = Buffer.from('{"mediaType":"application/vnd.dev.sigstore.bundle+json;version=0.1,"mode":"actions"}\n');
    return {
      launchers: {
        safe: "launchers/dusk-studio",
        local_actions: "launchers/dusk-studio-local-actions"
      },
      extraFiles: {
        "attestations/dusk-studio.sigstore.json": safeBundle,
        "attestations/dusk-studio-local-actions.sigstore.json": actionsBundle
      },
      attestations: {
        safe: {
          name: "attestations/dusk-studio.sigstore.json",
          bytes: safeBundle.length,
          sha256: sha256(safeBundle)
        },
        local_actions: {
          name: "attestations/dusk-studio-local-actions.sigstore.json",
          bytes: actionsBundle.length,
          sha256: sha256(actionsBundle)
        }
      }
    };
  }
  if (target === "darwin-arm64") {
    return {
      launchers: {
        safe: "Dusk Developer Studio.app/Contents/MacOS/dusk-studio",
        local_actions: "Dusk Developer Studio Local Actions.app/Contents/MacOS/dusk-studio-local-actions"
      },
      extraFiles: {
        "Dusk Developer Studio.app/Contents/Info.plist": Buffer.from("<plist><dict/></plist>\n"),
        "Dusk Developer Studio.app/Contents/_CodeSignature/CodeResources": Buffer.from("signed-safe\n"),
        "Dusk Developer Studio.app/Contents/CodeResources": Buffer.from("stapled-safe\n"),
        "Dusk Developer Studio Local Actions.app/Contents/Info.plist": Buffer.from("<plist><dict/></plist>\n"),
        "Dusk Developer Studio Local Actions.app/Contents/_CodeSignature/CodeResources": Buffer.from("signed-actions\n"),
        "Dusk Developer Studio Local Actions.app/Contents/CodeResources": Buffer.from("stapled-actions\n"),
        "evidence/macos-app-receipt.json": Buffer.from('{"schema_version":1}\n'),
        "evidence/notarization.json": Buffer.from('{"status":"Accepted"}\n')
      }
    };
  }
  return {
    launchers: {
      safe: "launchers/dusk-studio.exe",
      local_actions: "launchers/dusk-studio-local-actions.exe"
    },
    extraFiles: {}
  };
}

function recordsFromStage(stage, { host, launchers, descriptor }) {
  const records = [];
  const visit = (directory, relative = "") => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) {
        records.push({
          name: `${name}/`,
          data: Buffer.alloc(0),
          directory: true,
          host,
          flags: host === 19 ? UTF8_FLAG : 0,
          mode: DIRECTORY_TYPE | 0o755
        });
        visit(absolute, name);
      } else {
        records.push({
          name,
          data: fs.readFileSync(absolute),
          host,
          flags: host === 19 ? UTF8_FLAG : 0,
          descriptor,
          mode: REGULAR_TYPE | (launchers.has(name) ? 0o755 : 0o644)
        });
      }
    }
  };
  visit(stage);
  return records;
}

function cloneRecords(records) {
  return records.map((record) => ({
    ...record,
    data: Buffer.from(record.data),
    ...(record.centralExtra ? { centralExtra: Buffer.from(record.centralExtra) } : {}),
    ...(record.localExtra ? { localExtra: Buffer.from(record.localExtra) } : {})
  }));
}

function expectedFailurePattern(label) {
  if (label.startsWith("unsafe path")) return /unsafe path|printable ASCII/;
  const patterns = {
    "duplicate path": /duplicate or case-colliding path/,
    "case-colliding path": /duplicate or case-colliding path/,
    "symlink entry": /symlink or special entry/,
    "disguised non-Unix symlink entry": /symlink or special entry/,
    "special entry": /symlink or special entry/,
    "encrypted entry": /encrypted or unsupported entry flags/,
    "unsupported method": /unsupported compression method/,
    "empty deflate stream": /empty compressed stream/,
    "ZIP64 extra field": /ZIP64/,
    "wrong explicit launcher mode": /unexpected mode/,
    "forged CRC": /declared size or CRC/,
    "forged uncompressed size": /does not match its manifest file allowlist/,
    "compression bomb ratio": /exceeds its extraction bound/,
    "per-entry bound": /exceeds its extraction bound/,
    "total compressed bound": /total extraction bound/,
    "entry-count bound": /central-directory bounds/,
    "local-record overlap": /overlap|duplicate offsets/,
    "local-record gap": /gap after entry/,
    "trailing bytes": /comment-free end record/,
    "missing data descriptor": /data descriptor has an unsupported size/,
    "local and central path mismatch": /local path disagrees/,
    "unexpected manifest entry": /missing or unexpected file/
  };
  assert.ok(patterns[label], `missing constrained error pattern for ${label}`);
  return patterns[label];
}

let sequence = 0;
async function expectArchiveFailure(ephemeral, label, records, options = {}) {
  sequence += 1;
  const archive = path.join(ephemeral, `attack-${sequence}.zip`);
  const output = path.join(ephemeral, `attack-output-${sequence}`);
  zipBytes(archive, records, options);
  await assert.rejects(safeExtractStandaloneCandidateZip({
      archive,
      target: options.target ?? "windows-x64",
      ephemeralRoot: ephemeral,
      output
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, expectedFailurePattern(label));
      return true;
    },
    label
  );
  assert.equal(fs.existsSync(output), false, `${label} left a materialized output`);
}

function caseAlias(value) {
  const leaf = path.basename(value);
  const index = [...leaf].findIndex((character) => /[A-Za-z]/.test(character));
  if (index < 0) return value;
  const character = leaf[index];
  const toggled = character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase();
  return path.join(path.dirname(value), `${leaf.slice(0, index)}${toggled}${leaf.slice(index + 1)}`);
}

async function observeAtomicPublication(finalPath, privatePrefix, operation) {
  const originalRename = fs.renameSync;
  let observed = false;
  fs.renameSync = (source, destination) => {
    if (path.resolve(destination) === path.resolve(finalPath)) {
      assert.equal(fs.existsSync(finalPath), false);
      assert.match(path.basename(source), new RegExp(`^${privatePrefix}-`));
      assert.equal(fs.existsSync(source), true);
      observed = true;
    }
    return originalRename(source, destination);
  };
  try {
    await operation();
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(observed, true, `atomic publication was not observed for ${finalPath}`);
}

async function run() {
  const ephemeral = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-safe-zip-"));
  try {
    const exact = new Map();
    const stages = new Map();
    for (const target of ["windows-x64", "linux-x64", "darwin-arm64"]) {
      const fixture = exactStage(ephemeral, target);
      const records = recordsFromStage(fixture.stage, fixture);
      const archive = path.join(ephemeral, `exact-${target}.zip`);
      const secondArchive = path.join(ephemeral, `exact-${target}-repeat.zip`);
      const output = path.join(ephemeral, `installed-${target}`);
      const created = await createStandaloneCandidateZip({
        root: fixture.stage,
        target,
        ephemeralRoot: ephemeral,
        output: archive
      });
      const repeated = await createStandaloneCandidateZip({
        root: fixture.stage,
        target,
        ephemeralRoot: ephemeral,
        output: secondArchive
      });
      assert.equal(created.status, "deterministically-created");
      assert.equal(created.archive_sha256, repeated.archive_sha256);
      assert.deepEqual(fs.readFileSync(archive), fs.readFileSync(secondArchive));
      const metadata = centralMetadata(archive);
      const names = metadata.map((record) => record.name);
      assert.equal(names.every((name) => !name.includes("\\")), true);
      assert.equal(metadata.every((record) => record.host === 3), true);
      assert.equal(metadata.every((record) => record.name.endsWith("/")
        ? record.mode === (DIRECTORY_TYPE | 0o755)
        : record.mode === (REGULAR_TYPE | (fixture.launchers.has(record.name) ? 0o755 : 0o644))), true);
      if (target === "windows-x64") {
        assert.equal(names.includes("launchers/dusk-studio.exe"), true);
        assert.equal(names.includes("launchers/dusk-studio-local-actions.exe"), true);
      }
      const result = await safeExtractStandaloneCandidateZip({
        archive,
        target,
        ephemeralRoot: ephemeral,
        output
      });
      assert.equal(result.status, "safely-extracted");
      assert.equal(result.target, target);
      assert.match(result.archive_sha256, /^[a-f0-9]{64}$/);
      assert.equal(fs.readFileSync(path.join(output, "candidate-package-manifest.json"), "utf8").includes(`"target": "${target}"`), true);
      if (process.platform !== "win32") {
        for (const launcher of fixture.launchers) {
          assert.equal(fs.statSync(path.join(output, ...launcher.split("/"))).mode & 0o777, 0o755);
        }
        assert.equal(fs.statSync(path.join(output, "candidate-package-manifest.json")).mode & 0o777, 0o644);
      }
      exact.set(target, records);
      stages.set(target, fixture.stage);
    }

    const missingStapleStage = path.join(ephemeral, "stage-darwin-missing-staple");
    fs.cpSync(stages.get("darwin-arm64"), missingStapleStage, { recursive: true });
    fs.unlinkSync(path.join(missingStapleStage, "candidate-package-manifest.json"));
    fs.unlinkSync(path.join(missingStapleStage, "Dusk Developer Studio.app", "Contents", "CodeResources"));
    assert.throws(() => createCandidatePackageManifest({
      root: missingStapleStage,
      target: "darwin-arm64",
      buildReceipt: path.join(missingStapleStage, "evidence", "prototype-receipt.json"),
      signedLauncherIndex: path.join(missingStapleStage, "signed-launcher-index.json")
    }), /missing or unexpected inventory/);

    if (process.platform === "win32" || process.platform === "darwin") {
      const aliasedRoot = caseAlias(ephemeral);
      if (aliasedRoot !== ephemeral && fs.existsSync(aliasedRoot)) {
        const aliasedStage = path.join(aliasedRoot, path.basename(stages.get("windows-x64")));
        const aliasedArchive = path.join(aliasedRoot, "case-alias-windows.zip");
        const aliasedOutput = path.join(aliasedRoot, "case-alias-install");
        await createStandaloneCandidateZip({
          root: aliasedStage,
          target: "windows-x64",
          ephemeralRoot: aliasedRoot,
          output: aliasedArchive
        });
        await safeExtractStandaloneCandidateZip({
          archive: aliasedArchive,
          target: "windows-x64",
          ephemeralRoot: aliasedRoot,
          output: aliasedOutput
        });
        assert.equal(fs.statSync(path.join(ephemeral, "case-alias-install")).isDirectory(), true);
      }
    }

    const atomicArchive = path.join(ephemeral, "atomic-windows.zip");
    const atomicOutput = path.join(ephemeral, "atomic-windows-install");
    await observeAtomicPublication(atomicArchive, "zip-create", () => createStandaloneCandidateZip({
      root: stages.get("windows-x64"),
      target: "windows-x64",
      ephemeralRoot: ephemeral,
      output: atomicArchive
    }));
    await observeAtomicPublication(atomicOutput, "zip-extract", () => safeExtractStandaloneCandidateZip({
      archive: atomicArchive,
      target: "windows-x64",
      ephemeralRoot: ephemeral,
      output: atomicOutput
    }));

    const cleanupFailureOutput = path.join(ephemeral, "cleanup-failure-install");
    const originalUnlink = fs.unlinkSync;
    let injectedCleanupFailure = false;
    fs.unlinkSync = (file) => {
      if (!injectedCleanupFailure && path.basename(file).startsWith("zip-snapshot-")) {
        injectedCleanupFailure = true;
        throw new Error("injected snapshot cleanup failure");
      }
      return originalUnlink(file);
    };
    try {
      await assert.rejects(
        safeExtractStandaloneCandidateZip({
          archive: atomicArchive,
          target: "windows-x64",
          ephemeralRoot: ephemeral,
          output: cleanupFailureOutput
        }),
        /snapshot cleanup failed/i
      );
    } finally {
      fs.unlinkSync = originalUnlink;
    }
    assert.equal(injectedCleanupFailure, true);
    assert.equal(fs.existsSync(cleanupFailureOutput), false);

    const primaryFailureArchive = path.join(ephemeral, "primary-error-preservation.zip");
    const primaryFailureOutput = path.join(ephemeral, "primary-error-preservation-install");
    zipBytes(primaryFailureArchive, [{ name: "trailing", data: "fixture" }], {
      trailing: Buffer.from("trailing")
    });
    fs.unlinkSync = (file) => {
      if (path.basename(file).startsWith("zip-snapshot-")) {
        throw new Error("injected persistent snapshot cleanup failure");
      }
      return originalUnlink(file);
    };
    let primaryFailure;
    try {
      await safeExtractStandaloneCandidateZip({
        archive: primaryFailureArchive,
        target: "windows-x64",
        ephemeralRoot: ephemeral,
        output: primaryFailureOutput
      });
    } catch (error) {
      primaryFailure = error;
    } finally {
      fs.unlinkSync = originalUnlink;
    }
    assert.ok(primaryFailure instanceof Error);
    assert.match(primaryFailure.message, /comment-free end record/);
    assert.equal(Array.isArray(primaryFailure.cleanupErrors), true);
    assert.equal(primaryFailure.cleanupErrors.some((message) => message.includes("persistent snapshot cleanup failure")), true);
    assert.equal(fs.existsSync(primaryFailureOutput), false);
    for (const name of fs.readdirSync(ephemeral).filter((entry) => entry.startsWith("zip-snapshot-"))) {
      fs.chmodSync(path.join(ephemeral, name), 0o600);
      fs.unlinkSync(path.join(ephemeral, name));
    }

    const emptyDirectory = path.join(stages.get("windows-x64"), "unexpected-empty-directory");
    const rejectedCreateOutput = path.join(ephemeral, "rejected-empty-directory.zip");
    fs.mkdirSync(emptyDirectory);
    await assert.rejects(
      createStandaloneCandidateZip({
        root: stages.get("windows-x64"),
        target: "windows-x64",
        ephemeralRoot: ephemeral,
        output: rejectedCreateOutput
      }),
      /unexpected empty directory/
    );
    assert.equal(fs.existsSync(rejectedCreateOutput), false);
    fs.rmdirSync(emptyDirectory);

    const oversizedFixtureRoot = path.join(ephemeral, "oversized-fixture");
    fs.mkdirSync(oversizedFixtureRoot);
    const oversizedStage = exactStage(oversizedFixtureRoot, "windows-x64");
    const oversizedIndexPath = path.join(oversizedStage.stage, "signed-launcher-index.json");
    const oversizedIndex = JSON.parse(fs.readFileSync(oversizedIndexPath, "utf8"));
    oversizedIndex.padding = "x".repeat(STANDALONE_ZIP_LIMITS.metadataBytes);
    writeJson(oversizedIndexPath, oversizedIndex);
    const oversizedManifestPath = path.join(oversizedStage.stage, "candidate-package-manifest.json");
    fs.unlinkSync(oversizedManifestPath);
    writeJson(oversizedManifestPath, createCandidatePackageManifest({
      root: oversizedStage.stage,
      target: "windows-x64",
      buildReceipt: path.join(oversizedStage.stage, "evidence", "prototype-receipt.json"),
      signedLauncherIndex: oversizedIndexPath
    }));
    await assert.rejects(
      createStandaloneCandidateZip({
        root: oversizedStage.stage,
        target: "windows-x64",
        ephemeralRoot: ephemeral,
        output: path.join(ephemeral, "rejected-oversized-metadata.zip")
      }),
      /control metadata exceeds its bound/
    );

    const basic = (name, overrides = {}) => [{
      name,
      data: Buffer.from("fixture"),
      ...overrides
    }];
    for (const unsafe of [
      "../escape", "/absolute", "C:/drive", "nested\\backslash", "bad\u0000name", "bad*name",
      "CONIN$", "CONOUT$.txt", "CLOCK$"
    ]) {
      await expectArchiveFailure(ephemeral, `unsafe path ${JSON.stringify(unsafe)}`, basic(unsafe));
    }
    await expectArchiveFailure(ephemeral, "duplicate path", [
      { name: "same", data: "one" },
      { name: "same", data: "two" }
    ]);
    await expectArchiveFailure(ephemeral, "case-colliding path", [
      { name: "Path/File", data: "one" },
      { name: "path/file", data: "two" }
    ]);
    await expectArchiveFailure(ephemeral, "symlink entry", basic("link", {
      host: 3,
      mode: SYMLINK_TYPE | 0o777
    }));
    await expectArchiveFailure(ephemeral, "disguised non-Unix symlink entry", basic("link", {
      host: 0,
      mode: SYMLINK_TYPE | 0o777,
      externalAttributes: ((SYMLINK_TYPE | 0o777) << 16) >>> 0
    }));
    await expectArchiveFailure(ephemeral, "special entry", basic("device", {
      host: 3,
      mode: BLOCK_TYPE | 0o644
    }));
    await expectArchiveFailure(ephemeral, "encrypted entry", basic("encrypted", { flags: UTF8_FLAG | 1 }));
    await expectArchiveFailure(ephemeral, "unsupported method", basic("unsupported", { method: 12 }));
    await expectArchiveFailure(ephemeral, "empty deflate stream", basic("empty-deflate", {
      data: Buffer.alloc(0),
      method: 8,
      compressed: Buffer.alloc(0)
    }));
    const zip64Extra = Buffer.alloc(4);
    zip64Extra.writeUInt16LE(1, 0);
    await expectArchiveFailure(ephemeral, "ZIP64 extra field", basic("zip64", { centralExtra: zip64Extra }));

    const exactWindows = exact.get("windows-x64");
    const dosMetadataArchive = path.join(ephemeral, "exact-windows-dos-metadata.zip");
    const dosMetadataOutput = path.join(ephemeral, "installed-windows-dos-metadata");
    zipBytes(dosMetadataArchive, exactWindows);
    await safeExtractStandaloneCandidateZip({
      archive: dosMetadataArchive,
      target: "windows-x64",
      ephemeralRoot: ephemeral,
      output: dosMetadataOutput
    });

    const wrongLauncherMode = cloneRecords(exactWindows);
    const modeTarget = wrongLauncherMode.find((record) => record.name === "launchers/dusk-studio.exe");
    modeTarget.host = 3;
    modeTarget.mode = REGULAR_TYPE | 0o644;
    await expectArchiveFailure(ephemeral, "wrong explicit launcher mode", wrongLauncherMode);

    const forgedCrc = cloneRecords(exactWindows);
    const crcTarget = forgedCrc.find((record) => record.name === "launchers/dusk-studio.exe");
    crcTarget.crc = (crc32(crcTarget.data) ^ 1) >>> 0;
    await expectArchiveFailure(ephemeral, "forged CRC", forgedCrc);

    const forgedSize = cloneRecords(exactWindows);
    const sizeTarget = forgedSize.find((record) => record.name === "launchers/dusk-studio.exe");
    sizeTarget.uncompressedSize = sizeTarget.data.length + 1;
    await expectArchiveFailure(ephemeral, "forged uncompressed size", forgedSize);

    await expectArchiveFailure(ephemeral, "compression bomb ratio", basic("bomb", {
      data: Buffer.from("x"),
      uncompressedSize: STANDALONE_ZIP_LIMITS.ratioThresholdBytes + 1
    }));
    await expectArchiveFailure(ephemeral, "per-entry bound", basic("oversized", {
      data: Buffer.alloc(0),
      method: 0,
      compressedSize: STANDALONE_ZIP_LIMITS.entryCompressedBytes + 1,
      uncompressedSize: STANDALONE_ZIP_LIMITS.entryCompressedBytes + 1
    }));
    const totalBound = Array.from({ length: 4 }, (_, index) => ({
      name: `total-${index}`,
      data: Buffer.alloc(0),
      method: 0,
      compressedSize: 200 * 1024 * 1024,
      uncompressedSize: 200 * 1024 * 1024
    }));
    await expectArchiveFailure(ephemeral, "total compressed bound", totalBound);
    const tooMany = Array.from({ length: STANDALONE_ZIP_LIMITS.entries + 1 }, (_, index) => ({
      name: `entry-${String(index).padStart(4, "0")}`,
      data: Buffer.alloc(0),
      method: 0
    }));
    await expectArchiveFailure(ephemeral, "entry-count bound", tooMany);

    await expectArchiveFailure(ephemeral, "local-record overlap", [
      { name: "first", data: Buffer.alloc(0), method: 0 },
      { name: "second", data: Buffer.alloc(0), method: 0, centralLocalOffset: 0 }
    ]);
    await expectArchiveFailure(ephemeral, "local-record gap", [
      { name: "gapped", data: "data", method: 0, gapAfter: Buffer.from([0]) }
    ]);
    await expectArchiveFailure(ephemeral, "trailing bytes", basic("trailing"), {
      trailing: Buffer.from("trailing")
    });
    await expectArchiveFailure(ephemeral, "missing data descriptor", basic("descriptor", {
      descriptor: true,
      omitDescriptor: true
    }));
    await expectArchiveFailure(ephemeral, "local and central path mismatch", basic("central-name", {
      localName: "different-name"
    }));

    const withExtra = cloneRecords(exactWindows);
    withExtra.push({ name: "unexpected.txt", data: Buffer.from("not allowlisted") });
    await expectArchiveFailure(ephemeral, "unexpected manifest entry", withExtra);

    sequence += 1;
    const collisionArchive = path.join(ephemeral, `collision-${sequence}.zip`);
    const collisionOutput = path.join(ephemeral, `collision-output-${sequence}`);
    zipBytes(collisionArchive, exactWindows);
    fs.mkdirSync(collisionOutput);
    await assert.rejects(
      safeExtractStandaloneCandidateZip({
        archive: collisionArchive,
        target: "windows-x64",
        ephemeralRoot: ephemeral,
        output: collisionOutput
      }),
      /must not already exist/
    );
    assert.equal(fs.statSync(collisionOutput).isDirectory(), true);
    assert.deepEqual(
      fs.readdirSync(ephemeral).filter((name) => /^(?:zip-snapshot|zip-create|zip-extract)-/.test(name)),
      []
    );

    console.log("Standalone safe ZIP extractor tests passed.");
  } finally {
    fs.rmSync(ephemeral, { recursive: true, force: true });
  }
}

await run();
