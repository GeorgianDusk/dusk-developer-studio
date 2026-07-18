import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { createDeflateRaw, createInflateRaw, inflateRawSync } from "node:zlib";
import { cli } from "./companion-core.mjs";
import { verifyCandidatePackageManifest } from "./standalone-candidate-package-manifest.mjs";
import {
  UNSIGNED_INDEX_NAME,
  UNSIGNED_MANIFEST_NAME,
  verifyUnsignedPackageManifest
} from "./standalone-unsigned-assurance.mjs";

const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const SIGNED_MANIFEST_NAME = "candidate-package-manifest.json";
const SIGNED_INDEX_NAME = "signed-launcher-index.json";
const RECEIPT_NAME = "evidence/prototype-receipt.json";
const CONTROL_METADATA = new Set([
  SIGNED_MANIFEST_NAME,
  SIGNED_INDEX_NAME,
  UNSIGNED_MANIFEST_NAME,
  UNSIGNED_INDEX_NAME,
  RECEIPT_NAME
]);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA = 0x0001;
const UNICODE_PATH_EXTRA = 0x7075;
const AES_EXTRA = 0x9901;
const UTF8_FLAG = 0x0800;
const DESCRIPTOR_FLAG = 0x0008;
const ALLOWED_FLAGS = UTF8_FLAG | DESCRIPTOR_FLAG | 0x0006;
const UNIX_HOSTS = new Set([3, 19]);
const UNIX_TYPE_MASK = 0o170000;
const UNIX_REGULAR = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
const decoder = new TextDecoder("utf-8", { fatal: true });

function packageProfile(profile = "signed") {
  if (profile === "signed") {
    return {
      manifestName: SIGNED_MANIFEST_NAME,
      indexName: SIGNED_INDEX_NAME,
      manifestKeys: [
        "schema_version", "target", "version", "commit", "unsigned_asset_index_sha256",
        "signed_launcher_index_sha256", "files"
      ],
      verify: ({ root, target, receipt, index, manifest }) => verifyCandidatePackageManifest({
        root,
        target,
        buildReceipt: receipt,
        signedLauncherIndex: index,
        manifestFile: manifest
      })
    };
  }
  if (profile === "unsigned-engineering") {
    return {
      manifestName: UNSIGNED_MANIFEST_NAME,
      indexName: UNSIGNED_INDEX_NAME,
      manifestKeys: [
        "schema_version", "assurance_level", "target", "version", "commit", "platform_trust",
        "publication_eligible", "unsigned_launcher_index_sha256", "files"
      ],
      verify: ({ root, target, receipt, index, manifest }) => verifyUnsignedPackageManifest({
        root,
        target,
        buildReceipt: receipt,
        launcherIndex: index,
        manifestFile: manifest
      })
    };
  }
  throw new Error("Unsupported standalone candidate package profile.");
}

export const STANDALONE_ZIP_LIMITS = Object.freeze({
  archiveBytes: 1_342_177_280,
  centralDirectoryBytes: 16 * 1024 * 1024,
  entries: 4_096,
  pathBytes: 1_024,
  pathCharacters: 512,
  entryCompressedBytes: 256 * 1024 * 1024,
  entryUncompressedBytes: 512 * 1024 * 1024,
  totalCompressedBytes: 768 * 1024 * 1024,
  totalUncompressedBytes: 1024 * 1024 * 1024,
  metadataBytes: 1024 * 1024,
  ratioThresholdBytes: 1024 * 1024,
  compressionRatio: 200
});

const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < 256; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  CRC_TABLE[value] = crc >>> 0;
}

function updateCrc32(crc, chunk) {
  let next = crc;
  for (const byte of chunk) next = CRC_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

function crc32(buffer) {
  return (updateCrc32(0xffffffff, buffer) ^ 0xffffffff) >>> 0;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function samePath(left, right) {
  const first = path.resolve(left);
  const second = path.resolve(right);
  const aliasesCanDiffer = process.platform === "win32" || process.platform === "darwin";
  if (first !== second && (!aliasesCanDiffer || first.toLowerCase() !== second.toLowerCase())) return false;
  try {
    const a = fs.lstatSync(first, { bigint: true });
    const b = fs.lstatSync(second, { bigint: true });
    return sameFileIdentity(a, b);
  } catch {
    return first === second;
  }
}

function within(root, child) {
  const parent = path.resolve(root);
  return path.resolve(child).startsWith(`${parent}${path.sep}`);
}

function existingDirectoryContains(root, child) {
  let cursor = path.dirname(path.resolve(child));
  for (let depth = 0; depth < 256; depth += 1) {
    if (samePath(cursor, root)) return true;
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
  return false;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}

function readExact(fd, length, position, label) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    throw new Error(`${label} has an invalid byte range.`);
  }
  const result = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(fd, result, offset, length - offset, position + offset);
    if (count === 0) throw new Error(`${label} is truncated.`);
    offset += count;
  }
  return result;
}

function hashDescriptor(fd, size) {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < size) {
    const wanted = Math.min(chunk.length, size - position);
    const count = fs.readSync(fd, chunk, 0, wanted, position);
    if (count === 0) throw new Error("Candidate ZIP changed or became truncated while it was read.");
    hash.update(chunk.subarray(0, count));
    position += count;
  }
  return hash.digest("hex");
}

function privateSiblingPath(root, prefix, suffix = "") {
  return path.join(root, `${prefix}-${process.pid}-${randomBytes(12).toString("hex")}${suffix}`);
}

function attachCleanupError(primary, label, cleanupError) {
  if (!primary || (typeof primary !== "object" && typeof primary !== "function")) return;
  const details = Array.isArray(primary.cleanupErrors) ? primary.cleanupErrors : [];
  const nested = cleanupError instanceof AggregateError
    ? cleanupError.errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ")
    : "";
  const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  details.push(`${label}: ${message}${nested ? ` (${nested})` : ""}`);
  Object.defineProperty(primary, "cleanupErrors", {
    value: details,
    configurable: true,
    enumerable: false,
    writable: true
  });
}

function cleanupWithoutMasking(primary, label, action) {
  try {
    action();
  } catch (cleanupError) {
    attachCleanupError(primary, label, cleanupError);
  }
}

function privateDirectory(root, prefix) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const directory = privateSiblingPath(root, prefix);
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not reserve a private ${prefix} directory.`);
}

function privateFile(root, prefix, suffix, flags, mode) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const file = privateSiblingPath(root, prefix, suffix);
    try {
      return { path: file, fd: fs.openSync(file, flags | noFollow, mode) };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not reserve a private ${prefix} file.`);
}

function privateArchiveSnapshot(root, sourceFd, size) {
  const reserved = privateFile(root, "zip-snapshot", "",
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR, 0o600);
  const snapshotPath = reserved.path;
  const snapshotFd = reserved.fd;
  try {
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < size) {
      const wanted = Math.min(chunk.length, size - position);
      const count = fs.readSync(sourceFd, chunk, 0, wanted, position);
      if (count === 0) throw new Error("Candidate ZIP became truncated while its private snapshot was created.");
      hash.update(chunk.subarray(0, count));
      let written = 0;
      while (written < count) {
        const progress = fs.writeSync(snapshotFd, chunk, written, count - written, position + written);
        if (progress === 0) throw new Error("Candidate ZIP snapshot write made no progress.");
        written += progress;
      }
      position += count;
    }
    const source = fs.fstatSync(sourceFd);
    const snapshot = fs.fstatSync(snapshotFd);
    if (!source.isFile() || source.size !== size || !snapshot.isFile() || snapshot.size !== size) {
      throw new Error("Candidate ZIP changed size while its private snapshot was created.");
    }
    fs.fchmodSync(snapshotFd, 0o400);
    fs.fsyncSync(snapshotFd);
    return { path: snapshotPath, fd: snapshotFd, size, sha256: hash.digest("hex") };
  } catch (error) {
    cleanupWithoutMasking(error, "close private candidate ZIP snapshot", () => fs.closeSync(snapshotFd));
    cleanupWithoutMasking(error, "remove private candidate ZIP snapshot", () => {
      if (snapshotPath && fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    });
    throw error;
  }
}

function removeArchiveSnapshot(snapshot) {
  const failures = [];
  for (const [label, action] of [
    ["restore private snapshot cleanup mode", () => fs.fchmodSync(snapshot.fd, 0o600)],
    ["close private snapshot", () => fs.closeSync(snapshot.fd)],
    ["remove private snapshot", () => {
      if (fs.existsSync(snapshot.path)) fs.unlinkSync(snapshot.path);
    }]
  ]) {
    try {
      action();
    } catch (error) {
      failures.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  if (failures.length) throw new AggregateError(failures, "Private candidate ZIP snapshot cleanup failed.");
}

function existingRealRoot(value) {
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Ephemeral runner root must be a pre-existing non-symlink directory.");
  }
  const real = fs.realpathSync.native(resolved);
  if (!samePath(resolved, real)) {
    throw new Error("Ephemeral runner root must not cross a symlink or reparse boundary.");
  }
  return real;
}

function existingBoundedArchive(root, value) {
  const resolved = path.resolve(value);
  const real = fs.realpathSync.native(resolved);
  if (!samePath(resolved, real) || !existingDirectoryContains(root, real)) {
    throw new Error("Candidate ZIP must be beneath the ephemeral runner root without a symlink or reparse boundary.");
  }
  let cursor = root;
  for (const segment of path.relative(root, real).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("Candidate ZIP crosses a symlink or reparse boundary.");
  }
  const stat = fs.lstatSync(real);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Candidate ZIP must be a regular non-symlink file.");
  return { resolved: real, stat };
}

function existingBoundedDirectory(root, value, label) {
  const resolved = path.resolve(value);
  const real = fs.realpathSync.native(resolved);
  if (!samePath(resolved, real) || !existingDirectoryContains(root, real)) {
    throw new Error(`${label} must be beneath the ephemeral runner root without a symlink or reparse boundary.`);
  }
  let cursor = root;
  for (const segment of path.relative(root, real).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${label} crosses a symlink or reparse boundary.`);
  }
  const stat = fs.lstatSync(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
  return real;
}

function newDirectChild(root, value, label = "Extraction output") {
  const resolved = path.resolve(value);
  const leaf = path.basename(resolved);
  if (!samePath(path.dirname(resolved), root)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(leaf)
      || leaf.endsWith(".") || WINDOWS_RESERVED.test(leaf)) {
    throw new Error(`${label} must be a safely named direct child of the ephemeral runner root.`);
  }
  const canonical = path.join(root, leaf);
  if (fs.existsSync(resolved) || fs.existsSync(canonical)) throw new Error(`${label} must not already exist.`);
  return canonical;
}

function decodeArchiveName(bytes, flags) {
  if (bytes.length === 0 || bytes.length > STANDALONE_ZIP_LIMITS.pathBytes) {
    throw new Error("Candidate ZIP contains an empty or overlong path.");
  }
  if (!(flags & UTF8_FLAG) && bytes.some((byte) => byte > 0x7f)) {
    throw new Error("Candidate ZIP contains a non-ASCII legacy path.");
  }
  let value;
  try {
    value = decoder.decode(bytes);
  } catch {
    throw new Error("Candidate ZIP contains an invalid UTF-8 path.");
  }
  if (value.length > STANDALONE_ZIP_LIMITS.pathCharacters
      || [...value].some((character) => {
        const code = character.codePointAt(0);
        return code < 0x20 || code > 0x7e;
      })) {
    throw new Error("Candidate ZIP path must use bounded printable ASCII.");
  }
  return value;
}

function safeArchivePath(rawName, flags) {
  const value = decodeArchiveName(rawName, flags);
  if (value.includes("\\") || value.includes(":") || value.startsWith("/") || value.startsWith("//")
      || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Candidate ZIP contains an unsafe path: ${JSON.stringify(value)}.`);
  }
  const directory = value.endsWith("/");
  const logical = directory ? value.slice(0, -1) : value;
  const segments = logical.split("/");
  if (!logical || segments.some((segment) => !segment || segment === "." || segment === ".."
      || /[<>:"|?*]/.test(segment) || segment.endsWith(".") || segment.endsWith(" ")
      || WINDOWS_RESERVED.test(segment))) {
    throw new Error(`Candidate ZIP contains an unsafe path: ${JSON.stringify(value)}.`);
  }
  return { name: segments.join("/"), directory, folded: segments.join("/").toLowerCase() };
}

function validateExtraFields(buffer, label) {
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) throw new Error(`${label} has a truncated extra field.`);
    const id = buffer.readUInt16LE(offset);
    const length = buffer.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + length > buffer.length) throw new Error(`${label} has a truncated extra-field value.`);
    if (id === ZIP64_EXTRA) throw new Error("ZIP64 candidate packages are not supported.");
    if (id === UNICODE_PATH_EXTRA) throw new Error("Candidate ZIP contains an ambiguous Unicode path field.");
    if (id === AES_EXTRA) throw new Error("Encrypted candidate ZIP entries are not supported.");
    offset += length;
  }
}

function validateFlags(flags, method) {
  if (flags & ~ALLOWED_FLAGS) throw new Error("Candidate ZIP uses encrypted or unsupported entry flags.");
  if (method !== 8 && (flags & 0x0006)) {
    throw new Error("Candidate ZIP uses deflate-only flags with a different compression method.");
  }
}

function validateExternalType(entry) {
  const dosAttributes = entry.externalAttributes & 0xffff;
  const type = entry.unixMode & UNIX_TYPE_MASK;
  if (dosAttributes & 0x0440) throw new Error(`Candidate ZIP contains a reparse or device entry: ${entry.name}.`);
  if (type && type !== UNIX_REGULAR && type !== UNIX_DIRECTORY) {
    throw new Error(`Candidate ZIP contains a symlink or special entry: ${entry.name}.`);
  }
  if (!UNIX_HOSTS.has(entry.host)) {
    if ((dosAttributes & 0x0010) && !entry.directory) {
      throw new Error(`Candidate ZIP DOS entry type disagrees with its path: ${entry.name}.`);
    }
    return;
  }
  if (type !== UNIX_REGULAR && type !== UNIX_DIRECTORY) {
    throw new Error(`Candidate ZIP contains a symlink or special entry: ${entry.name}.`);
  }
  if ((type === UNIX_DIRECTORY) !== entry.directory) {
    throw new Error(`Candidate ZIP entry type disagrees with its path: ${entry.name}.`);
  }
}

function parseCentralDirectory(fd, archiveSize) {
  if (archiveSize < 22 || archiveSize > STANDALONE_ZIP_LIMITS.archiveBytes) {
    throw new Error("Candidate ZIP archive size is outside the supported bound.");
  }
  const eocdOffset = archiveSize - 22;
  const eocd = readExact(fd, 22, eocdOffset, "Candidate ZIP end record");
  if (eocd.readUInt32LE(0) !== EOCD_SIGNATURE || eocd.readUInt16LE(20) !== 0) {
    throw new Error("Candidate ZIP must have one comment-free end record with no trailing bytes.");
  }
  const disk = eocd.readUInt16LE(4);
  const centralDisk = eocd.readUInt16LE(6);
  const diskEntries = eocd.readUInt16LE(8);
  const totalEntries = eocd.readUInt16LE(10);
  const centralSize = eocd.readUInt32LE(12);
  const centralOffset = eocd.readUInt32LE(16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries
      || totalEntries === 0 || totalEntries === 0xffff
      || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("Candidate ZIP must be a non-empty single-disk non-ZIP64 archive.");
  }
  if (totalEntries > STANDALONE_ZIP_LIMITS.entries
      || centralSize > STANDALONE_ZIP_LIMITS.centralDirectoryBytes
      || centralOffset + centralSize !== eocdOffset) {
    throw new Error("Candidate ZIP central-directory bounds are invalid.");
  }
  const central = readExact(fd, centralSize, centralOffset, "Candidate ZIP central directory");
  const entries = [];
  const names = new Set();
  const foldedNames = new Set();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let offset = 0;
  while (offset < central.length) {
    if (entries.length >= totalEntries || offset + 46 > central.length
        || central.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("Candidate ZIP central directory is malformed.");
    }
    const versionMadeBy = central.readUInt16LE(offset + 4);
    const versionNeeded = central.readUInt16LE(offset + 6);
    const flags = central.readUInt16LE(offset + 8);
    const method = central.readUInt16LE(offset + 10);
    const modifiedTime = central.readUInt16LE(offset + 12);
    const modifiedDate = central.readUInt16LE(offset + 14);
    const expectedCrc = central.readUInt32LE(offset + 16);
    const compressedSize = central.readUInt32LE(offset + 20);
    const uncompressedSize = central.readUInt32LE(offset + 24);
    const nameLength = central.readUInt16LE(offset + 28);
    const extraLength = central.readUInt16LE(offset + 30);
    const commentLength = central.readUInt16LE(offset + 32);
    const diskStart = central.readUInt16LE(offset + 34);
    const externalAttributes = central.readUInt32LE(offset + 38);
    const localOffset = central.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > central.length || commentLength !== 0 || diskStart !== 0
        || versionNeeded > 20 || compressedSize === 0xffffffff
        || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("Candidate ZIP uses an unsupported central-directory feature.");
    }
    if (method !== 0 && method !== 8) throw new Error("Candidate ZIP uses an unsupported compression method.");
    validateFlags(flags, method);
    const rawName = central.subarray(offset + 46, offset + 46 + nameLength);
    const extra = central.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    validateExtraFields(extra, "Candidate ZIP central entry");
    const safe = safeArchivePath(rawName, flags);
    if (names.has(safe.name) || foldedNames.has(safe.folded)) {
      throw new Error(`Candidate ZIP contains a duplicate or case-colliding path: ${safe.name}.`);
    }
    names.add(safe.name);
    foldedNames.add(safe.folded);
    if (safe.directory && (compressedSize !== 0 || uncompressedSize !== 0 || expectedCrc !== 0 || method !== 0)) {
      throw new Error(`Candidate ZIP directory entry has data: ${safe.name}.`);
    }
    if (method === 0 && compressedSize !== uncompressedSize) {
      throw new Error(`Stored candidate ZIP entry has inconsistent sizes: ${safe.name}.`);
    }
    if (method === 8 && compressedSize === 0) {
      throw new Error(`Deflated candidate ZIP entry has an empty compressed stream: ${safe.name}.`);
    }
    if (compressedSize > STANDALONE_ZIP_LIMITS.entryCompressedBytes
        || uncompressedSize > STANDALONE_ZIP_LIMITS.entryUncompressedBytes
        || (uncompressedSize > STANDALONE_ZIP_LIMITS.ratioThresholdBytes
          && uncompressedSize / Math.max(1, compressedSize) > STANDALONE_ZIP_LIMITS.compressionRatio)) {
      throw new Error(`Candidate ZIP entry exceeds its extraction bound: ${safe.name}.`);
    }
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalCompressed > STANDALONE_ZIP_LIMITS.totalCompressedBytes
        || totalUncompressed > STANDALONE_ZIP_LIMITS.totalUncompressedBytes) {
      throw new Error("Candidate ZIP exceeds its total extraction bound.");
    }
    const entry = {
      ...safe,
      versionMadeBy,
      versionNeeded,
      host: versionMadeBy >>> 8,
      unixMode: externalAttributes >>> 16,
      externalAttributes,
      flags,
      method,
      modifiedTime,
      modifiedDate,
      expectedCrc,
      compressedSize,
      uncompressedSize,
      localOffset,
      rawName: Buffer.from(rawName)
    };
    validateExternalType(entry);
    entries.push(entry);
    offset = end;
  }
  if (entries.length !== totalEntries || offset !== central.length) {
    throw new Error("Candidate ZIP central-directory entry count is inconsistent.");
  }
  validatePathHierarchy(entries);
  validateLocalRecords(fd, entries, centralOffset);
  return { entries, centralOffset, totalCompressed, totalUncompressed };
}

function validatePathHierarchy(entries) {
  const byFolded = new Map(entries.map((entry) => [entry.folded, entry]));
  for (const entry of entries) {
    const segments = entry.name.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = byFolded.get(segments.slice(0, index).join("/").toLowerCase());
      if (ancestor && !ancestor.directory) {
        throw new Error(`Candidate ZIP file is used as a parent directory: ${ancestor.name}.`);
      }
    }
  }
}

function validateLocalRecords(fd, entries, centralOffset) {
  const ordered = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  if (ordered[0]?.localOffset !== 0) {
    throw new Error("Candidate ZIP contains prepended bytes or a gap before its first entry.");
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    const boundary = ordered[index + 1]?.localOffset ?? centralOffset;
    if (boundary <= entry.localOffset || entry.localOffset + 30 > boundary) {
      throw new Error("Candidate ZIP local records overlap or have duplicate offsets.");
    }
    const local = readExact(fd, 30, entry.localOffset, `Candidate ZIP local header for ${entry.name}`);
    if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error("Candidate ZIP local-header signature is invalid.");
    const versionNeeded = local.readUInt16LE(4);
    const flags = local.readUInt16LE(6);
    const method = local.readUInt16LE(8);
    const modifiedTime = local.readUInt16LE(10);
    const modifiedDate = local.readUInt16LE(12);
    const localCrc = local.readUInt32LE(14);
    const localCompressed = local.readUInt32LE(18);
    const localUncompressed = local.readUInt32LE(22);
    const nameLength = local.readUInt16LE(26);
    const extraLength = local.readUInt16LE(28);
    const headerEnd = entry.localOffset + 30 + nameLength + extraLength;
    if (headerEnd > boundary || versionNeeded !== entry.versionNeeded || flags !== entry.flags
        || method !== entry.method || modifiedTime !== entry.modifiedTime || modifiedDate !== entry.modifiedDate) {
      throw new Error(`Candidate ZIP local header disagrees with its central entry: ${entry.name}.`);
    }
    const variable = readExact(fd, nameLength + extraLength, entry.localOffset + 30, `Candidate ZIP local path for ${entry.name}`);
    const localName = variable.subarray(0, nameLength);
    if (!localName.equals(entry.rawName)) {
      throw new Error(`Candidate ZIP local path disagrees with its central entry: ${entry.name}.`);
    }
    validateExtraFields(variable.subarray(nameLength), "Candidate ZIP local entry");
    const descriptor = Boolean(entry.flags & DESCRIPTOR_FLAG);
    if (!descriptor && (localCrc !== entry.expectedCrc
        || localCompressed !== entry.compressedSize || localUncompressed !== entry.uncompressedSize)) {
      throw new Error(`Candidate ZIP local sizes or CRC disagree with the central entry: ${entry.name}.`);
    }
    if (descriptor && !((localCrc === 0 || localCrc === entry.expectedCrc)
        && (localCompressed === 0 || localCompressed === entry.compressedSize)
        && (localUncompressed === 0 || localUncompressed === entry.uncompressedSize))) {
      throw new Error(`Candidate ZIP data-descriptor placeholders are invalid: ${entry.name}.`);
    }
    const dataEnd = headerEnd + entry.compressedSize;
    if (dataEnd > boundary) throw new Error(`Candidate ZIP entry overlaps the next record: ${entry.name}.`);
    if (descriptor) {
      validateDescriptor(fd, entry, dataEnd, boundary);
    } else if (dataEnd !== boundary) {
      throw new Error(`Candidate ZIP contains a gap after entry: ${entry.name}.`);
    }
    entry.dataOffset = headerEnd;
  }
}

function validateDescriptor(fd, entry, dataEnd, boundary) {
  const length = boundary - dataEnd;
  if (length !== 12 && length !== 16) {
    throw new Error(`Candidate ZIP data descriptor has an unsupported size: ${entry.name}.`);
  }
  const descriptor = readExact(fd, length, dataEnd, `Candidate ZIP data descriptor for ${entry.name}`);
  const base = length === 16 ? 4 : 0;
  if (length === 16 && descriptor.readUInt32LE(0) !== DESCRIPTOR_SIGNATURE) {
    throw new Error(`Candidate ZIP data-descriptor signature is invalid: ${entry.name}.`);
  }
  if (descriptor.readUInt32LE(base) !== entry.expectedCrc
      || descriptor.readUInt32LE(base + 4) !== entry.compressedSize
      || descriptor.readUInt32LE(base + 8) !== entry.uncompressedSize) {
    throw new Error(`Candidate ZIP data descriptor disagrees with the central entry: ${entry.name}.`);
  }
}

function readMetadataEntry(fd, entry, label) {
  if (!entry || entry.directory || entry.uncompressedSize > STANDALONE_ZIP_LIMITS.metadataBytes
      || entry.compressedSize > STANDALONE_ZIP_LIMITS.metadataBytes) {
    throw new Error(`${label} is missing or exceeds its metadata bound.`);
  }
  const compressed = readExact(fd, entry.compressedSize, entry.dataOffset, label);
  let value;
  try {
    value = entry.method === 0
      ? compressed
      : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize + 1) });
  } catch {
    throw new Error(`${label} cannot be decompressed within its bound.`);
  }
  if (value.length !== entry.uncompressedSize || crc32(value) !== entry.expectedCrc) {
    throw new Error(`${label} fails its declared size or CRC.`);
  }
  return value;
}

function parseJsonMetadata(fd, entry, label) {
  const bytes = readMetadataEntry(fd, entry, label);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validateManifestAllowlist(fd, entries, target, profile) {
  const contract = packageProfile(profile);
  const files = entries.filter((entry) => !entry.directory);
  const byName = new Map(files.map((entry) => [entry.name, entry]));
  const manifest = parseJsonMetadata(
    fd, byName.get(contract.manifestName), "Candidate package manifest"
  );
  exactKeys(manifest, contract.manifestKeys, "Candidate package manifest");
  if (manifest.schema_version !== 1 || manifest.target !== target || !Array.isArray(manifest.files)) {
    throw new Error("Candidate package manifest identity is invalid.");
  }
  const allowed = new Set([contract.manifestName]);
  const folded = new Set([contract.manifestName.toLowerCase()]);
  for (const record of manifest.files) {
    exactKeys(record, ["path", "bytes", "sha256"], "Candidate package manifest file");
    const raw = Buffer.from(String(record.path ?? ""), "utf8");
    const safe = safeArchivePath(raw, UTF8_FLAG);
    if (safe.directory || folded.has(safe.folded)
        || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !SHA256_RE.test(record.sha256 ?? "")) {
      throw new Error("Candidate package manifest contains an invalid file record.");
    }
    const entry = byName.get(safe.name);
    if (!entry || entry.uncompressedSize !== record.bytes) {
      throw new Error("Candidate package ZIP does not match its manifest file allowlist.");
    }
    allowed.add(safe.name);
    folded.add(safe.folded);
  }
  if (allowed.size !== files.length || files.some((entry) => !allowed.has(entry.name))) {
    throw new Error("Candidate package ZIP contains a missing or unexpected file.");
  }
  for (const entry of entries.filter((item) => item.directory)) {
    if (![...allowed].some((name) => name.startsWith(`${entry.name}/`))) {
      throw new Error(`Candidate package ZIP contains an unexpected directory: ${entry.name}.`);
    }
  }
  const index = parseJsonMetadata(fd, byName.get(contract.indexName), "Candidate launcher index");
  if (index?.schema_version !== 1 || index.target !== target || !index.launchers
      || index.launchers.safe?.mode !== "safe" || index.launchers.local_actions?.mode !== "local-actions") {
    throw new Error("Candidate launcher index identity is invalid.");
  }
  const executables = new Set();
  for (const launcher of [index.launchers.safe, index.launchers.local_actions]) {
    const safe = safeArchivePath(Buffer.from(String(launcher.name ?? ""), "utf8"), UTF8_FLAG);
    if (safe.directory || !allowed.has(safe.name)) {
      throw new Error("Candidate launcher index contains an unsafe or absent launcher.");
    }
    executables.add(safe.name);
  }
  if (executables.size !== 2 || !allowed.has(RECEIPT_NAME)) {
    throw new Error("Candidate package does not contain two distinct launchers and its fixed build receipt.");
  }
  const receipt = parseJsonMetadata(fd, byName.get(RECEIPT_NAME), "Standalone build receipt");
  if (receipt?.schema_version !== 3 || receipt.target !== target) {
    throw new Error("Standalone build receipt identity is invalid.");
  }
  validateModes(entries, target, executables);
  return { manifest, executables };
}

function validateModes(entries, target, executables) {
  for (const entry of entries) {
    if (!UNIX_HOSTS.has(entry.host)) {
      if (target === "windows-x64") continue;
      throw new Error(`POSIX candidate ZIP entry is missing a Unix mode: ${entry.name}.`);
    }
    const expectedType = entry.directory ? UNIX_DIRECTORY : UNIX_REGULAR;
    const expectedPermissions = entry.directory || executables.has(entry.name) ? 0o755 : 0o644;
    if ((entry.unixMode & UNIX_TYPE_MASK) !== expectedType || (entry.unixMode & 0o7777) !== expectedPermissions) {
      throw new Error(`POSIX candidate ZIP entry has an unexpected mode: ${entry.name}.`);
    }
  }
}

function ensureDirectory(root, relative) {
  let cursor = root;
  for (const segment of relative ? relative.split("/") : []) {
    cursor = path.join(cursor, segment);
    if (!within(root, cursor)) throw new Error("Candidate ZIP directory escaped the extraction root.");
    try {
      fs.mkdirSync(cursor, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Candidate ZIP extraction encountered a symlink or non-directory parent.");
      }
    }
  }
  return cursor;
}

class EntryIntegrity extends Transform {
  constructor(entry) {
    super();
    this.entry = entry;
    this.bytes = 0;
    this.crc = 0xffffffff;
  }

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes > this.entry.uncompressedSize) {
      callback(new Error(`Candidate ZIP entry expands beyond its declared size: ${this.entry.name}.`));
      return;
    }
    this.crc = updateCrc32(this.crc, chunk);
    callback(null, chunk);
  }

  _flush(callback) {
    const observedCrc = (this.crc ^ 0xffffffff) >>> 0;
    if (this.bytes !== this.entry.uncompressedSize || observedCrc !== this.entry.expectedCrc) {
      callback(new Error(`Candidate ZIP entry fails its declared size or CRC: ${this.entry.name}.`));
      return;
    }
    callback();
  }
}

async function extractFile(fd, archive, output, entry) {
  const parent = entry.name.includes("/") ? entry.name.slice(0, entry.name.lastIndexOf("/")) : "";
  ensureDirectory(output, parent);
  const destination = path.join(output, ...entry.name.split("/"));
  if (!within(output, destination)) throw new Error("Candidate ZIP file escaped the extraction root.");
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const outputFd = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL
    | fs.constants.O_WRONLY | noFollow, 0o600);
  if (entry.compressedSize === 0) {
    fs.closeSync(outputFd);
    if (entry.method !== 0 || entry.uncompressedSize !== 0 || entry.expectedCrc !== 0) {
      throw new Error(`Candidate ZIP empty entry has inconsistent integrity data: ${entry.name}.`);
    }
    return;
  }
  const input = fs.createReadStream(archive, {
    fd,
    autoClose: false,
    start: entry.dataOffset,
    end: entry.dataOffset + entry.compressedSize - 1
  });
  const integrity = new EntryIntegrity(entry);
  const writer = fs.createWriteStream(destination, { fd: outputFd, autoClose: true });
  if (entry.method === 0) {
    await pipeline(input, integrity, writer);
    return;
  }
  const inflater = createInflateRaw();
  await pipeline(input, inflater, integrity, writer);
  if (inflater.bytesWritten !== entry.compressedSize) {
    throw new Error(`Candidate ZIP compressed stream contains trailing data: ${entry.name}.`);
  }
}

function chmodExact(file, mode, kind) {
  const before = fs.lstatSync(file, { bigint: true });
  if (before.isSymbolicLink() || (kind === "directory" ? !before.isDirectory() : !before.isFile())) {
    throw new Error("Candidate package changed filesystem type after manifest verification.");
  }
  if (process.platform === "win32" && kind === "directory") {
    fs.chmodSync(file, mode);
    const after = fs.lstatSync(file, { bigint: true });
    if (!sameFileIdentity(before, after) || !after.isDirectory() || after.isSymbolicLink()) {
      throw new Error("Candidate package directory identity changed while its mode was applied.");
    }
    return;
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const directoryOnly = kind === "directory" ? (fs.constants.O_DIRECTORY ?? 0) : 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | directoryOnly);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!sameFileIdentity(before, opened)
        || (kind === "directory" ? !opened.isDirectory() : !opened.isFile())) {
      throw new Error("Candidate package identity changed before its mode was applied.");
    }
    fs.fchmodSync(fd, mode);
  } finally {
    fs.closeSync(fd);
  }
}

function applyModes(output, entries, executables) {
  const directories = new Set();
  for (const entry of entries) {
    const segments = entry.name.split("/");
    const stop = entry.directory ? segments.length : segments.length - 1;
    for (let index = 1; index <= stop; index += 1) directories.add(segments.slice(0, index).join("/"));
  }
  for (const entry of entries.filter((item) => !item.directory)) {
    chmodExact(path.join(output, ...entry.name.split("/")), executables.has(entry.name) ? 0o755 : 0o644, "file");
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    chmodExact(path.join(output, ...directory.split("/")), 0o755, "directory");
  }
}

function removeCreatedTree(root, expectedParent) {
  if (!samePath(path.dirname(root), expectedParent) || !fs.existsSync(root)) return;
  const visit = (current) => {
    if (!samePath(current, root) && !within(root, current)) {
      throw new Error("Private extraction cleanup escaped its bounded root.");
    }
    const stat = fs.lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fs.unlinkSync(current);
      return;
    }
    const real = fs.realpathSync.native(current);
    if (!samePath(current, real)) {
      throw new Error("Private extraction cleanup encountered a junction or reparse boundary.");
    }
    for (const name of fs.readdirSync(current)) visit(path.join(current, name));
    const after = fs.lstatSync(current, { bigint: true });
    if (!sameFileIdentity(stat, after) || !after.isDirectory() || after.isSymbolicLink()) {
      throw new Error("Private extraction directory identity changed during cleanup.");
    }
    fs.rmdirSync(current);
  };
  visit(root);
}

function validateStageFilesystemBoundaries(stage) {
  const folded = new Set();
  let entries = 0;
  let totalBytes = 0;
  const visit = (directory, relative = "") => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      const safe = safeArchivePath(Buffer.from(name, "utf8"), UTF8_FLAG);
      if (folded.has(safe.folded)) throw new Error(`Candidate stage contains a case-colliding path: ${safe.name}.`);
      folded.add(safe.folded);
      entries += 1;
      if (entries > STANDALONE_ZIP_LIMITS.entries) throw new Error("Candidate stage exceeds its entry-count bound.");
      const source = path.join(directory, item.name);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error(`Candidate stage contains a symlink or reparse entry: ${safe.name}.`);
      if (stat.isDirectory()) {
        visit(source, safe.name);
      } else if (stat.isFile()) {
        if (stat.size > STANDALONE_ZIP_LIMITS.entryUncompressedBytes) {
          throw new Error(`Candidate stage file exceeds its package bound: ${safe.name}.`);
        }
        totalBytes += stat.size;
        if (totalBytes > STANDALONE_ZIP_LIMITS.totalUncompressedBytes) {
          throw new Error("Candidate stage exceeds its total uncompressed-data bound.");
        }
      } else {
        throw new Error(`Candidate stage contains a non-regular filesystem entry: ${safe.name}.`);
      }
    }
  };
  visit(stage);
}

function stageContract(stage, target, profile) {
  const packageContract = packageProfile(profile);
  const manifestPath = path.join(stage, packageContract.manifestName);
  const indexPath = path.join(stage, packageContract.indexName);
  for (const name of [packageContract.manifestName, packageContract.indexName, RECEIPT_NAME]) {
    const file = path.join(stage, ...name.split("/"));
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > STANDALONE_ZIP_LIMITS.metadataBytes) {
      throw new Error(`Candidate package control metadata exceeds its bound: ${name}.`);
    }
  }
  const manifest = packageContract.verify({
    root: stage,
    target,
    receipt: path.join(stage, ...RECEIPT_NAME.split("/")),
    index: indexPath,
    manifest: manifestPath
  });
  const manifestBytes = fs.readFileSync(manifestPath);
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    throw new Error("Candidate launcher index is not valid JSON.");
  }
  if (index?.schema_version !== 1 || index.target !== target
      || index.launchers?.safe?.mode !== "safe"
      || index.launchers?.local_actions?.mode !== "local-actions") {
    throw new Error("Candidate launcher index identity is invalid.");
  }
  const executables = new Set();
  for (const launcher of [index.launchers.safe, index.launchers.local_actions]) {
    const safe = safeArchivePath(Buffer.from(String(launcher.name ?? ""), "utf8"), UTF8_FLAG);
    if (safe.directory) throw new Error("Candidate launcher index contains an invalid launcher path.");
    executables.add(safe.name);
  }
  if (executables.size !== 2) throw new Error("Candidate launcher index must contain two distinct launchers.");
  const expected = new Map(manifest.files.map((record) => [
    record.path,
    { bytes: record.bytes, sha256: record.sha256 }
  ]));
  expected.set(packageContract.manifestName, {
    bytes: manifestBytes.length,
    sha256: createHash("sha256").update(manifestBytes).digest("hex")
  });
  for (const name of executables) {
    if (!expected.has(name)) {
      throw new Error("Candidate launcher index references a file outside the package manifest.");
    }
  }
  return {
    manifest,
    manifestSha256: expected.get(packageContract.manifestName).sha256,
    expected,
    executables
  };
}

function inventoryStage(stage, contract) {
  const records = [];
  const seen = new Set();
  const seenFiles = new Set();
  let totalBytes = 0;
  const visit = (directory, relative = "") => {
    const items = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const item of items) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      const safe = safeArchivePath(Buffer.from(name, "utf8"), UTF8_FLAG);
      if (seen.has(safe.folded)) throw new Error(`Candidate stage contains a case-colliding path: ${safe.name}.`);
      seen.add(safe.folded);
      const source = path.join(directory, item.name);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error(`Candidate stage contains a symlink or reparse entry: ${safe.name}.`);
      if (stat.isDirectory()) {
        records.push({
          name: safe.name,
          archiveName: `${safe.name}/`,
          directory: true,
          source,
          mode: UNIX_DIRECTORY | 0o755
        });
        visit(source, safe.name);
      } else if (stat.isFile()) {
        const expected = contract.expected.get(safe.name);
        if (!expected || expected.bytes !== stat.size) {
          throw new Error(`Candidate stage file does not match the package manifest: ${safe.name}.`);
        }
        if (stat.size > STANDALONE_ZIP_LIMITS.entryUncompressedBytes) {
          throw new Error(`Candidate stage file exceeds its package bound: ${safe.name}.`);
        }
        totalBytes += stat.size;
        seenFiles.add(safe.name);
        records.push({
          name: safe.name,
          archiveName: safe.name,
          directory: false,
          source,
          bytes: stat.size,
          sha256: expected.sha256,
          mode: UNIX_REGULAR | (contract.executables.has(safe.name) ? 0o755 : 0o644)
        });
      } else {
        throw new Error(`Candidate stage contains a non-regular filesystem entry: ${safe.name}.`);
      }
    }
  };
  visit(stage);
  if (records.length > STANDALONE_ZIP_LIMITS.entries
      || totalBytes > STANDALONE_ZIP_LIMITS.totalUncompressedBytes
      || seenFiles.size !== contract.expected.size
      || [...contract.expected.keys()].some((name) => !seenFiles.has(name))) {
    throw new Error("Candidate stage inventory exceeds bounds or differs from its package manifest.");
  }
  const fileNames = [...contract.expected.keys()];
  for (const record of records.filter((item) => item.directory)) {
    if (!fileNames.some((name) => name.startsWith(`${record.name}/`))) {
      throw new Error(`Candidate stage contains an unexpected empty directory: ${record.name}.`);
    }
  }
  records.sort((left, right) => Buffer.compare(Buffer.from(left.archiveName), Buffer.from(right.archiveName)));
  return { records, totalBytes };
}

function assertStageFilePath(stage, file) {
  if (!within(stage, file)) throw new Error("Candidate stage file escaped its package root.");
  let cursor = stage;
  for (const segment of path.relative(stage, file).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("Candidate stage file crosses a symlink or reparse boundary.");
  }
}

class PackageIntegrity extends Transform {
  constructor(record) {
    super();
    this.record = record;
    this.bytes = 0;
    this.crc = 0xffffffff;
    this.hash = createHash("sha256");
  }

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    if (this.bytes > this.record.bytes) {
      callback(new Error(`Candidate stage file grew while it was archived: ${this.record.name}.`));
      return;
    }
    this.crc = updateCrc32(this.crc, chunk);
    this.hash.update(chunk);
    callback(null, chunk);
  }

  _flush(callback) {
    this.crc = (this.crc ^ 0xffffffff) >>> 0;
    if (this.bytes !== this.record.bytes || this.hash.digest("hex") !== this.record.sha256) {
      callback(new Error(`Candidate stage file changed or fails its manifest digest: ${this.record.name}.`));
      return;
    }
    callback();
  }
}

class ArchiveWriter {
  constructor(fd) {
    this.fd = fd;
    this.position = 0;
  }

  write(buffer) {
    if (this.position + buffer.length > STANDALONE_ZIP_LIMITS.archiveBytes) {
      throw new Error("Deterministic candidate ZIP exceeds its archive bound.");
    }
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.writeSync(this.fd, buffer, offset, buffer.length - offset, this.position + offset);
      if (count === 0) throw new Error("Deterministic candidate ZIP write made no progress.");
      offset += count;
    }
    this.position += buffer.length;
  }
}

class ArchiveSink extends Writable {
  constructor(writer) {
    super();
    this.writer = writer;
    this.bytes = 0;
  }

  _write(chunk, _encoding, callback) {
    try {
      this.writer.write(chunk);
      this.bytes += chunk.length;
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

function localHeader(name, { method, descriptor }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(method === 8 || descriptor ? 20 : 10, 4);
  header.writeUInt16LE(UTF8_FLAG | (descriptor ? DESCRIPTOR_FLAG : 0), 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(record) {
  const name = Buffer.from(record.archiveName, "ascii");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE((3 << 8) | 20, 4);
  header.writeUInt16LE(record.method === 8 || record.descriptor ? 20 : 10, 6);
  header.writeUInt16LE(UTF8_FLAG | (record.descriptor ? DESCRIPTOR_FLAG : 0), 8);
  header.writeUInt16LE(record.method, 10);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(record.crc, 16);
  header.writeUInt32LE(record.compressedBytes, 20);
  header.writeUInt32LE(record.uncompressedBytes, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE((((record.mode << 16) >>> 0) | (record.directory ? 0x10 : 0)) >>> 0, 38);
  header.writeUInt32LE(record.localOffset, 42);
  return Buffer.concat([header, name]);
}

async function archiveStageRecord(stage, writer, record) {
  const name = Buffer.from(record.archiveName, "ascii");
  const localOffset = writer.position;
  if (record.directory) {
    writer.write(localHeader(name, { method: 0, descriptor: false }));
    writer.write(name);
    return {
      ...record,
      localOffset,
      method: 0,
      descriptor: false,
      crc: 0,
      compressedBytes: 0,
      uncompressedBytes: 0
    };
  }
  assertStageFilePath(stage, record.source);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const sourceFd = fs.openSync(record.source, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(sourceFd);
    if (!opened.isFile() || opened.size !== record.bytes) {
      throw new Error(`Candidate stage file changed identity before archiving: ${record.name}.`);
    }
    writer.write(localHeader(name, { method: 8, descriptor: true }));
    writer.write(name);
    const integrity = new PackageIntegrity(record);
    const deflater = createDeflateRaw({ level: 9 });
    const sink = new ArchiveSink(writer);
    const input = fs.createReadStream(record.source, {
      fd: sourceFd,
      autoClose: false,
      highWaterMark: 64 * 1024
    });
    await pipeline(input, integrity, deflater, sink);
    if (fs.fstatSync(sourceFd).size !== record.bytes
        || sink.bytes > STANDALONE_ZIP_LIMITS.entryCompressedBytes
        || (CONTROL_METADATA.has(record.name) && sink.bytes > STANDALONE_ZIP_LIMITS.metadataBytes)
        || (record.bytes > STANDALONE_ZIP_LIMITS.ratioThresholdBytes
          && record.bytes / Math.max(1, sink.bytes) > STANDALONE_ZIP_LIMITS.compressionRatio)) {
      throw new Error(`Candidate stage file cannot be represented within the ZIP bounds: ${record.name}.`);
    }
    writer.write(descriptorRecord(integrity.crc, sink.bytes, record.bytes));
    return {
      ...record,
      localOffset,
      method: 8,
      descriptor: true,
      crc: integrity.crc,
      compressedBytes: sink.bytes,
      uncompressedBytes: record.bytes
    };
  } finally {
    fs.closeSync(sourceFd);
  }
}

function descriptorRecord(crc, compressedBytes, uncompressedBytes) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(compressedBytes, 8);
  descriptor.writeUInt32LE(uncompressedBytes, 12);
  return descriptor;
}

function endRecord(entries, centralBytes, centralOffset) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entries, 8);
  eocd.writeUInt16LE(entries, 10);
  eocd.writeUInt32LE(centralBytes, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return eocd;
}

function hashRegularFile(file) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > STANDALONE_ZIP_LIMITS.archiveBytes) {
      throw new Error("Created candidate ZIP has an invalid filesystem type or size.");
    }
    return { bytes: stat.size, sha256: hashDescriptor(fd, stat.size) };
  } finally {
    fs.closeSync(fd);
  }
}

export async function createStandaloneCandidateZip({
  root: packageRoot, target, ephemeralRoot, output, profile = "signed"
}) {
  if (!TARGETS.has(target)) throw new Error("Unsupported standalone candidate ZIP target.");
  const ephemeral = existingRealRoot(ephemeralRoot);
  const stage = existingBoundedDirectory(ephemeral, packageRoot, "Candidate package stage");
  const out = newDirectChild(ephemeral, output, "Candidate ZIP output");
  if (!out.toLowerCase().endsWith(".zip")) throw new Error("Candidate ZIP output must have a .zip extension.");
  if (within(stage, out)) throw new Error("Candidate ZIP output must remain outside the package stage.");
  validateStageFilesystemBoundaries(stage);
  const contract = stageContract(stage, target, profile);
  const inventory = inventoryStage(stage, contract);
  const temporary = privateFile(ephemeral, "zip-create", ".tmp.zip",
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  let fd = temporary.fd;
  try {
    const writer = new ArchiveWriter(fd);
    const archived = [];
    let totalCompressed = 0;
    for (const record of inventory.records) {
      const completed = await archiveStageRecord(stage, writer, record);
      totalCompressed += completed.compressedBytes;
      if (totalCompressed > STANDALONE_ZIP_LIMITS.totalCompressedBytes) {
        throw new Error("Deterministic candidate ZIP exceeds its total compressed-data bound.");
      }
      archived.push(completed);
    }
    const centralOffset = writer.position;
    const central = Buffer.concat(archived.map(centralHeader));
    if (central.length > STANDALONE_ZIP_LIMITS.centralDirectoryBytes) {
      throw new Error("Deterministic candidate ZIP central directory exceeds its bound.");
    }
    writer.write(central);
    writer.write(endRecord(archived.length, central.length, centralOffset));
    fs.fchmodSync(fd, 0o644);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const after = stageContract(stage, target, profile);
    if (JSON.stringify(after.manifest) !== JSON.stringify(contract.manifest)
        || after.manifestSha256 !== contract.manifestSha256) {
      throw new Error("Candidate package stage changed while its ZIP was created.");
    }
    const archive = hashRegularFile(temporary.path);
    const result = {
      status: "deterministically-created",
      target,
      archive_sha256: archive.sha256,
      archive_bytes: archive.bytes,
      files: contract.expected.size,
      entries: archived.length,
      uncompressed_bytes: inventory.totalBytes,
      compressed_bytes: totalCompressed,
      output: out
    };
    if (fs.existsSync(out)) throw new Error("Candidate ZIP output appeared before atomic publication.");
    fs.renameSync(temporary.path, out);
    return result;
  } catch (error) {
    cleanupWithoutMasking(error, "close private candidate ZIP output", () => {
      if (fd !== undefined) fs.closeSync(fd);
      fd = undefined;
    });
    cleanupWithoutMasking(error, "remove private candidate ZIP output", () => {
      if (fs.existsSync(temporary.path)) fs.unlinkSync(temporary.path);
    });
    throw error;
  }
}

export async function safeExtractStandaloneCandidateZip({
  archive, target, ephemeralRoot, output, profile = "signed"
}) {
  if (!TARGETS.has(target)) throw new Error("Unsupported standalone candidate ZIP target.");
  const root = existingRealRoot(ephemeralRoot);
  const candidate = existingBoundedArchive(root, archive);
  const out = newDirectChild(root, output);
  if (within(out, candidate.resolved)) throw new Error("Candidate ZIP must remain outside its extraction output.");
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const sourceFd = fs.openSync(candidate.resolved, fs.constants.O_RDONLY | noFollow);
  let snapshot;
  try {
    const opened = fs.fstatSync(sourceFd);
    if (!opened.isFile() || opened.size !== candidate.stat.size || opened.size > STANDALONE_ZIP_LIMITS.archiveBytes) {
      throw new Error("Candidate ZIP changed identity before validation.");
    }
    snapshot = privateArchiveSnapshot(root, sourceFd, opened.size);
  } catch (error) {
    cleanupWithoutMasking(error, "close candidate ZIP source", () => fs.closeSync(sourceFd));
    throw error;
  }
  try {
    fs.closeSync(sourceFd);
  } catch (error) {
    cleanupWithoutMasking(error, "remove private candidate ZIP snapshot", () => removeArchiveSnapshot(snapshot));
    throw error;
  }
  let working;
  try {
    const parsed = parseCentralDirectory(snapshot.fd, snapshot.size);
    const packageContract = packageProfile(profile);
    const contract = validateManifestAllowlist(snapshot.fd, parsed.entries, target, profile);
    working = privateDirectory(root, "zip-extract");
    for (const entry of parsed.entries) {
      if (entry.directory) {
        ensureDirectory(working, entry.name);
      } else {
        await extractFile(snapshot.fd, snapshot.path, working, entry);
      }
    }
    packageContract.verify({
      root: working,
      target,
      receipt: path.join(working, ...RECEIPT_NAME.split("/")),
      index: path.join(working, packageContract.indexName),
      manifest: path.join(working, packageContract.manifestName)
    });
    applyModes(working, parsed.entries, contract.executables);
    const archiveSha256 = snapshot.sha256;
    removeArchiveSnapshot(snapshot);
    snapshot = undefined;
    const result = {
      status: "safely-extracted",
      target,
      archive_sha256: archiveSha256,
      files: contract.manifest.files.length + 1,
      compressed_bytes: parsed.totalCompressed,
      uncompressed_bytes: parsed.totalUncompressed,
      output: out
    };
    if (fs.existsSync(out)) throw new Error("Extraction output appeared before atomic publication.");
    fs.renameSync(working, out);
    working = undefined;
    return result;
  } catch (error) {
    if (snapshot) cleanupWithoutMasking(error, "remove private candidate ZIP snapshot", () => {
      removeArchiveSnapshot(snapshot);
      snapshot = undefined;
    });
    if (working) cleanupWithoutMasking(error, "remove private extraction directory", () => {
      removeCreatedTree(working, root);
      working = undefined;
    });
    throw error;
  }
}

const isMain = process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    const required = args.create
      ? ["root", "target", "ephemeral-root", "out"]
      : ["archive", "target", "ephemeral-root", "out"];
    for (const name of required) {
      if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    const result = args.create
      ? await createStandaloneCandidateZip({
        root: args.root,
        target: args.target,
        ephemeralRoot: args["ephemeral-root"],
        output: args.out,
        profile: args.profile ?? "signed"
      })
      : await safeExtractStandaloneCandidateZip({
        archive: args.archive,
        target: args.target,
        ephemeralRoot: args["ephemeral-root"],
        output: args.out,
        profile: args.profile ?? "signed"
      });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Candidate ZIP extraction failed.");
    process.exitCode = 1;
  }
}
