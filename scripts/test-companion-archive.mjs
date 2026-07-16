import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeterministicArchive } from "./companion-archive.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-companion-archive-test-"));
function put(file, value, mode) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); if (mode) fs.chmodSync(file, mode); }
function fixture(target) {
  const release = path.join(root, "release-" + target); fs.mkdirSync(release);
  const launcher = target === "windows-x64" ? "dusk-studio.cmd" : "dusk-studio";
  const actionLauncher = target === "windows-x64" ? "dusk-studio-local-actions.cmd" : "dusk-studio-local-actions";
  const runtime = target === "windows-x64" ? "runtime/node.exe" : "runtime/node";
  put(path.join(release, "payload", "bin", launcher), "launcher\n", 0o755);
  put(path.join(release, "payload", "bin", actionLauncher), "action launcher\n", 0o755);
  put(path.join(release, "payload", ...runtime.split("/")), "runtime\n", 0o755);
  put(path.join(release, "payload", "studio", "index.html"), "<!doctype html>\n");
  const manifestBytes = JSON.stringify({ schema_version: 1, version: "0.1.0", target, runtime: { binary_path: runtime } });
  put(path.join(release, "payload-manifest.json"), manifestBytes);
  put(path.join(release, "payload", "payload-manifest.json"), manifestBytes);
  put(path.join(release, "companion-provenance.json"), JSON.stringify({ predicate: { buildDefinition: { internalParameters: { source_date_epoch: 1_700_000_000 } } } }));
  return release;
}
function tarModes(file) {
  const bytes = gunzipSync(fs.readFileSync(file)); const modes = new Map(); let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512); const read = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "");
    const name = read(0, 100); if (!name) break; const prefix = read(345, 155); const size = Number.parseInt(read(124, 12).trim() || "0", 8);
    modes.set(prefix ? `${prefix}/${name}` : name, Number.parseInt(read(100, 8).trim(), 8));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return modes;
}
function inspect(target, extension) {
  const release = fixture(target); const first = path.join(root, target + "-one" + extension); const second = path.join(root, target + "-two" + extension);
  const one = createDeterministicArchive({ releaseDir: release, outFile: first }); const two = createDeterministicArchive({ releaseDir: release, outFile: second });
  assert.equal(one.sha256, two.sha256); assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  const listing = spawnSync("tar", ["-tf", first], { encoding: "utf8", shell: false, windowsHide: true });
  assert.equal(listing.status, 0, listing.stderr); assert.ok(listing.stdout.includes(`${one.rootName}/studio/index.html`)); assert.ok(!listing.stdout.includes(`${one.rootName}/payload/`));
  const extracted = path.join(root, "extracted-" + target); fs.mkdirSync(extracted); const unpack = spawnSync("tar", ["-xf", first, "-C", extracted], { encoding: "utf8", shell: false, windowsHide: true }); assert.equal(unpack.status, 0, unpack.stderr);
  assert.equal(fs.readFileSync(path.join(extracted, one.rootName, "studio", "index.html"), "utf8"), "<!doctype html>\n");
  if (target === "linux-x64" || target === "darwin-arm64") {
    const modes = tarModes(first);
    for (const relative of ["runtime/node", "bin/dusk-studio", "bin/dusk-studio-local-actions"]) assert.equal(modes.get(`${one.rootName}/${relative}`), 0o755);
  }
}
try { inspect("windows-x64", ".zip"); inspect("linux-x64", ".tar.gz"); inspect("darwin-arm64", ".tar.gz"); console.log("Companion deterministic Windows ZIP plus Linux and macOS tar.gz fixtures passed."); }
finally { fs.rmSync(root, { recursive: true, force: true }); }
