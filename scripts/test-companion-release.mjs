import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease, digest, selectRuntimeArchiveEntries, validateRuntimeArchiveEntry, verifyRelease } from "./companion-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-companion-release-test-"));
const target = process.platform === "win32" ? "windows-x64" : "linux-x64";
const commit = "a".repeat(40);

assert.equal(
  validateRuntimeArchiveEntry("node-v24.11.0-linux-x64/lib/node_modules/npm/index.js", "node-v24.11.0-linux-x64"),
  "node-v24.11.0-linux-x64/lib/node_modules/npm/index.js"
);
assert.throws(() => validateRuntimeArchiveEntry("../outside.txt", "node-v24.11.0-linux-x64"), /Unsafe runtime archive path/);
assert.throws(() => validateRuntimeArchiveEntry("other-root/node", "node-v24.11.0-linux-x64"), /outside node-v24.11.0-linux-x64/);
const runtimeArchiveConfig = { archive_root: "node-v24.11.0-linux-x64", source_binary_path: "bin/node" };
assert.deepEqual(
  selectRuntimeArchiveEntries(
    "node-v24.11.0-linux-x64/LICENSE\nnode-v24.11.0-linux-x64/bin/node\nnode-v24.11.0-linux-x64/lib/node_modules/npm/index.js\n",
    runtimeArchiveConfig
  ),
  ["node-v24.11.0-linux-x64/bin/node", "node-v24.11.0-linux-x64/LICENSE"]
);
assert.throws(() => selectRuntimeArchiveEntries("node-v24.11.0-linux-x64/LICENSE\n", runtimeArchiveConfig), /missing .*bin\/node/);

function put(relative, contents) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function treeDigest(directory) {
  const records = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => b.name.localeCompare(a.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else records.push({ path: path.relative(directory, absolute).replaceAll(path.sep, "/"), sha256: digest(fs.readFileSync(absolute)) });
    }
  }
  return digest(JSON.stringify(records.sort((a, b) => a.path.localeCompare(b.path))));
}

function build(out, extra = {}) {
  return buildRelease({ productRoot, target, outDir: out, launcherBundle: path.join(root, "launcher"), runtimeRoot: path.join(root, "runtime"), runtimeRootVerified: true, studioDist: path.join(root, "studio"), templateRoot: path.join(root, "template"), commit, sourceDateEpoch: 1_700_000_000, executeRuntime: false, ...extra });
}

function verifyFixture(releaseDir, extra = {}) {
  return verifyRelease({ productRoot, releaseDir, executeRuntime: false, ...extra });
}

try {
  put("launcher/companion.mjs", "console.log('fixture companion');\n");
  put("studio/index.html", "<!doctype html><title>Dusk fixture</title>\n");
  put("studio/assets/app.js", "console.log('studio fixture');\n");
  put("template/.env.example", "RPC_URL=https://example.invalid\n");
  put("template/foundry.toml", "[profile.default]\nsrc = 'src'\n");
  put("runtime/LICENSE", "Node.js fixture license\n");
  const runtimeBinary = target === "windows-x64" ? put("runtime/node.exe", fs.readFileSync(process.execPath)) : put("runtime/bin/node", fs.readFileSync(process.execPath));
  if (target === "linux-x64") fs.chmodSync(runtimeBinary, 0o755);

  const first = build(path.join(root, "release-one"));
  const second = build(path.join(root, "release-two"));
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(treeDigest(first.outDir), treeDigest(second.outDir));
  const verified = verifyFixture(first.outDir);
  assert.equal(verified.manifest.signing_status, "unsigned-rc");
  assert.equal(verified.manifest.unsigned_rc, true);
  assert.deepEqual(Object.keys(verified.manifest), ["schema_version", "product", "version", "commit", "channel", "target", "runtime", "unsigned_rc", "signing_status", "files"]);
  assert.deepEqual(Object.keys(verified.manifest.runtime), ["name", "version", "archive_url", "archive_sha256", "binary_path", "binary_sha256"]);
  assert.ok(verified.manifest.files.every((record) => Object.keys(record).join(",") === "path,bytes,sha256"));
  assert.throws(() => verifyFixture(first.outDir, { publication: true }), /Unsigned RCs cannot pass publication/);

  assert.deepEqual(fs.readFileSync(path.join(first.outDir, "payload", "payload-manifest.json")), fs.readFileSync(path.join(first.outDir, "payload-manifest.json")));
  assert.ok(first.manifest.files.some((record) => record.path === (target === "windows-x64" ? "bin/dusk-studio-local-actions.cmd" : "bin/dusk-studio-local-actions")));

  const appFile = path.join(first.outDir, "payload", "app", "companion.mjs");
  fs.appendFileSync(appFile, "tamper\n");
  assert.throws(() => verifyFixture(first.outDir), /parity failed/);
  fs.writeFileSync(appFile, "console.log('fixture companion');\n");
  put(path.relative(root, path.join(first.outDir, "payload", "undeclared.txt")).replaceAll(path.sep, "/"), "extra\n");
  assert.throws(() => verifyFixture(first.outDir), /undeclared or missing/);
  fs.rmSync(path.join(first.outDir, "payload", "undeclared.txt"));

  assert.throws(() => buildRelease({ productRoot, target, outDir: path.join(root, "not-verified"), launcherBundle: path.join(root, "launcher"), runtimeRoot: path.join(root, "runtime"), studioDist: path.join(root, "studio"), templateRoot: path.join(root, "template"), commit }), /attest a verified/);
  assert.throws(() => build(path.join(root, "unsigned-publication"), { releaseMode: "publication" }), /require an Ed25519 signing key/);
  const fakeArchive = put("runtime-fake.zip", "not the pinned runtime archive");
  assert.throws(() => buildRelease({ productRoot, target, outDir: path.join(root, "bad-archive"), launcherBundle: path.join(root, "launcher"), runtimeArchive: fakeArchive, studioDist: path.join(root, "studio"), templateRoot: path.join(root, "template"), commit }), /pinned official SHA-256/);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateFile = put("keys/signing-private.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
  const publicFile = put("keys/signing-public.pem", publicKey.export({ type: "spki", format: "pem" }));
  const signed = build(path.join(root, "signed"), { releaseMode: "publication", signingPrivateKey: privateFile });
  assert.equal(signed.manifest.signing_status, "signed");
  assert.equal(verifyFixture(signed.outDir, { publication: true, trustedPublicKey: publicFile }).signed, true);
  const wrongPair = generateKeyPairSync("ed25519");
  const wrongPublic = put("keys/wrong-public.pem", wrongPair.publicKey.export({ type: "spki", format: "pem" }));
  assert.throws(() => verifyFixture(signed.outDir, { publication: true, trustedPublicKey: wrongPublic }), /signature or trusted key identity/);

  const darwinRuntime = put("runtime-darwin/bin/node", fs.readFileSync(process.execPath));
  fs.chmodSync(darwinRuntime, 0o755); put("runtime-darwin/LICENSE", "Node.js fixture license\n");
  const darwin = buildRelease({ productRoot, target: "darwin-arm64", outDir: path.join(root, "release-darwin"), launcherBundle: path.join(root, "launcher"), runtimeRoot: path.join(root, "runtime-darwin"), runtimeRootVerified: true, studioDist: path.join(root, "studio"), templateRoot: path.join(root, "template"), commit, sourceDateEpoch: 1_700_000_000, executeRuntime: false });
  const verifiedDarwin = verifyFixture(darwin.outDir);
  assert.equal(verifiedDarwin.manifest.target, "darwin-arm64");
  for (const entrypoint of ["bin/dusk-studio", "bin/dusk-studio-local-actions", "runtime/node"]) assert.ok(verifiedDarwin.manifest.files.some((record) => record.path === entrypoint));

  put("unsafe-launcher/companion.mjs", "const leaked = 'C:\\Users\\build-user\\project';\n");
  assert.throws(() => build(path.join(root, "host-path"), { launcherBundle: path.join(root, "unsafe-launcher") }), /absolute build-host path/);
  const secretFixtureName = ["PRIVATE", "KEY"].join("_");
  put("secret-launcher/companion.mjs", `const value = '${secretFixtureName}=0123456789abcdef0123456789abcdef';\n`);
  assert.throws(() => build(path.join(root, "secret"), { launcherBundle: path.join(root, "secret-launcher") }), /secret-like material/);
  put("forbidden-template/.env.local", "VALUE=fixture\n");
  assert.throws(() => build(path.join(root, "forbidden-path"), { templateRoot: path.join(root, "forbidden-template") }), /Forbidden payload segment/);

  const symlinkTarget = put("symlink-source/real.txt", "fixture\n");
  try {
    fs.symlinkSync(symlinkTarget, path.join(root, "symlink-source", "linked.txt"), "file");
    assert.throws(() => build(path.join(root, "symlink"), { launcherBundle: path.join(root, "symlink-source") }), /Symlink or reparse entry/);
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
  }

  console.log("Companion deterministic payload, parity, safety, SBOM/provenance, and signing fixtures passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
