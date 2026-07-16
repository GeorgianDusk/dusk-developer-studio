import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { deflateRawSync, gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[index] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function walkFiles(root, directory = root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Release archive input contains a symlink or reparse entry.");
    if (stat.isDirectory()) files.push(...walkFiles(root, absolute));
    else if (stat.isFile()) files.push({ absolute, relative: path.relative(root, absolute).replaceAll(path.sep, "/"), mode: stat.mode });
    else throw new Error("Release archive input contains a non-regular entry.");
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function archiveFiles(releaseDir) {
  const records = walkFiles(releaseDir);
  const sidecar = records.find((record) => record.relative === "payload-manifest.json");
  const embedded = records.find((record) => record.relative === "payload/payload-manifest.json");
  if (!sidecar || !embedded || !fs.readFileSync(sidecar.absolute).equals(fs.readFileSync(embedded.absolute))) throw new Error("Release archive requires matching sidecar and embedded payload manifests.");
  const flattened = []; const names = new Set();
  for (const record of records) {
    if (record.relative === "payload/payload-manifest.json") continue;
    const relative = record.relative.startsWith("payload/") ? record.relative.slice("payload/".length) : record.relative;
    if (names.has(relative)) throw new Error(`Flattened release archive path collides: ${relative}`);
    names.add(relative); flattened.push({ ...record, relative });
  }
  return flattened.sort((a, b) => a.relative.localeCompare(b.relative));
}

function archiveRoot(manifest) {
  if (!/^[0-9A-Za-z.-]+$/.test(manifest.version) || !/^(?:windows-x64|linux-x64|darwin-arm64)$/.test(manifest.target)) throw new Error("Release identity cannot form a safe archive root.");
  return `dusk-developer-studio-local-${manifest.version}-${manifest.target}`;
}

function zipBytes(releaseDir, rootName) {
  const local = []; const central = []; let offset = 0;
  for (const record of archiveFiles(releaseDir)) {
    const name = Buffer.from(`${rootName}/${record.relative}`, "utf8");
    const body = fs.readFileSync(record.absolute); const compressed = deflateRawSync(body, { level: 9 }); const checksum = crc32(body);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x031e, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(0, 12); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(body.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((record.mode & 0xffff) << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); const count = central.length / 2; end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function putField(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8"); if (bytes.length > length) throw new Error("Tar archive path or field exceeds USTAR limits."); bytes.copy(header, offset);
}
function octal(value, length) { const result = value.toString(8).padStart(length - 1, "0") + "\0"; if (result.length > length) throw new Error("Tar numeric field exceeds USTAR limits."); return result; }
function splitTarPath(value) {
  if (Buffer.byteLength(value) <= 100) return { name: value, prefix: "" };
  for (let index = value.lastIndexOf("/"); index > 0; index = value.lastIndexOf("/", index - 1)) {
    const prefix = value.slice(0, index); const name = value.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error("Tar archive path exceeds USTAR limits.");
}
function tarBytes(releaseDir, rootName, epoch, manifest) {
  const chunks = []; const records = archiveFiles(releaseDir);
  const executablePaths = new Set([manifest.runtime?.binary_path, "bin/dusk-studio", "bin/dusk-studio-local-actions"]);
  for (const required of executablePaths) if (typeof required !== "string" || !records.some((record) => record.relative === required)) throw new Error(`POSIX archive is missing executable ${required}.`);
  for (const record of records) {
    const body = fs.readFileSync(record.absolute); const pathname = splitTarPath(`${rootName}/${record.relative}`); const header = Buffer.alloc(512);
    putField(header, 0, 100, pathname.name); putField(header, 100, 8, octal(executablePaths.has(record.relative) ? 0o755 : 0o644, 8)); putField(header, 108, 8, octal(0, 8)); putField(header, 116, 8, octal(0, 8)); putField(header, 124, 12, octal(body.length, 12)); putField(header, 136, 12, octal(epoch, 12));
    header.fill(0x20, 148, 156); header[156] = 0x30; putField(header, 257, 6, "ustar\0"); putField(header, 263, 2, "00"); putField(header, 345, 155, pathname.prefix);
    let sum = 0; for (const byte of header) sum += byte; putField(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
    chunks.push(header, body); const remainder = body.length % 512; if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024)); return Buffer.concat(chunks);
}

export function createDeterministicArchive({ releaseDir, outFile }) {
  const release = path.resolve(releaseDir); const output = path.resolve(outFile);
  if (fs.existsSync(output)) throw new Error(`Archive output already exists: ${output}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(release, "payload-manifest.json"), "utf8")); const rootName = archiveRoot(manifest);
  const provenance = JSON.parse(fs.readFileSync(path.join(release, "companion-provenance.json"), "utf8")); const epoch = Number(provenance.predicate?.buildDefinition?.internalParameters?.source_date_epoch ?? 0);
  if (!Number.isInteger(epoch) || epoch < 0) throw new Error("Release provenance has an invalid source epoch.");
  let bytes;
  if (manifest.target === "windows-x64") { if (!output.endsWith(".zip")) throw new Error("Windows release archives must use .zip."); bytes = zipBytes(release, rootName); }
  else { if (!output.endsWith(".tar.gz")) throw new Error("Linux and macOS release archives must use .tar.gz."); const compressed = gzipSync(tarBytes(release, rootName, epoch, manifest), { level: 9 }); compressed.fill(0, 4, 8); compressed[9] = 255; bytes = compressed; }
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes);
  return { output, rootName, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { const args = cli(process.argv.slice(2)); if (!args.release || !args.out) throw new Error("Usage: node scripts/companion-archive.mjs --release=<directory> --out=<new-zip-or-tar.gz>"); console.log(JSON.stringify(createDeterministicArchive({ releaseDir: args.release, outFile: args.out }), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Companion archive failed."); process.exitCode = 1; }
}
