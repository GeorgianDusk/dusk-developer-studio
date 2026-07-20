import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artifactFingerprint,
  artifactFingerprintFromRecords,
  createAssuranceReceipt,
  validateAssuranceReceipt,
  writeAssuranceReceipt
} from "./assurance-metadata.mjs";

const fileRecord = (root, relative) => {
  const bytes = fs.readFileSync(path.join(root, ...relative.split("/")));
  return {
    path: relative,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength
  };
};

const sourceRoot = path.resolve(process.cwd());
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-studio-assurance-"));
try {
  fs.cpSync(path.join(sourceRoot, "config"), path.join(root, "config"), { recursive: true });
  fs.cpSync(path.join(sourceRoot, "data"), path.join(root, "data"), { recursive: true });
  fs.cpSync(path.join(sourceRoot, "deploy"), path.join(root, "deploy"), { recursive: true });
  fs.mkdirSync(path.join(root, "apps", "studio", "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "index.html"), "<main>fixture</main>");
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "assets", "app.js"), "console.log('fixture')");
  const { receipt } = writeAssuranceReceipt(root);
  assert.equal(validateAssuranceReceipt(root, receipt).sourceUrls > 0, true);
  const distRoot = path.join(root, "apps", "studio", "dist");
  const manifestStyleRecords = [
    fileRecord(distRoot, "index.html"),
    fileRecord(distRoot, "assurance-receipt.json"),
    fileRecord(distRoot, "assets/app.js"),
    { path: "nested/release-manifest.json", sha256: "e".repeat(64), bytes: 17 }
  ];
  const initialFingerprint = artifactFingerprint(root);
  assert.equal(artifactFingerprintFromRecords(manifestStyleRecords), initialFingerprint);
  const pathFixture = { bytes: 1, sha256: "f".repeat(64) };
  assert.doesNotThrow(() =>
    artifactFingerprintFromRecords([{ path: "assets/app @+ ü.js", ...pathFixture }])
  );
  for (const unsafePath of [
    "/absolute.js",
    "../escape.js",
    "assets/../escape.js",
    "assets//app.js",
    "assets\\app.js",
    `assets/${String.fromCharCode(0)}app.js`
  ]) {
    assert.throws(
      () => artifactFingerprintFromRecords([{ path: unsafePath, ...pathFixture }]),
      /invalid or duplicated/
    );
  }
  fs.writeFileSync(path.join(distRoot, "assurance-receipt.json"), '{"changed":"metadata"}\n');
  fs.writeFileSync(path.join(distRoot, "release-manifest.json"), '{"changed":"metadata"}\n');
  assert.equal(artifactFingerprint(root), initialFingerprint);
  fs.writeFileSync(path.join(distRoot, "assets", "app.js"), "console.log('changed product asset')");
  assert.notEqual(artifactFingerprint(root), initialFingerprint);
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "assets", "large.js"), "x".repeat(500_000));
  assert.throws(() => createAssuranceReceipt(root), /budget exceeded/);
  fs.rmSync(path.join(root, "apps", "studio", "dist", "assets", "large.js"));
  const caddy = path.join(root, "deploy", "caddy", "studio.caddy");
  const safeCaddy = fs.readFileSync(caddy, "utf8");
  fs.writeFileSync(caddy, safeCaddy.replace('header @receipts Cache-Control "no-store"', 'header @receipts Cache-Control "max-age=60"'));
  assert.throws(() => createAssuranceReceipt(root), /release receipts/);
  fs.writeFileSync(caddy, safeCaddy.replace("X-Frame-Options", "Missing-Frame-Options"));
  assert.throws(() => createAssuranceReceipt(root), /X-Frame-Options/);
  console.log("Assurance policy fixtures passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
