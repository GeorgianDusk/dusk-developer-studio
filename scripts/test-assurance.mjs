import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssuranceReceipt, validateAssuranceReceipt, writeAssuranceReceipt } from "./assurance-metadata.mjs";

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
