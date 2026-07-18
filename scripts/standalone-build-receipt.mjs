import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const PRODUCT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeLock = JSON.parse(fs.readFileSync(path.join(PRODUCT_ROOT, "config", "companion-runtime-lock.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(PRODUCT_ROOT, "package.json"), "utf8"));
const FROZEN_RUNTIME_VERSION = runtimeLock.runtime.version;
const FROZEN_POSTJECT_VERSION = packageJson.devDependencies.postject;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function validateLauncher(record, { target, version, key, mode }) {
  exactKeys(record, ["mode", "name", "bytes", "sha256"], `${mode} launcher receipt`);
  const extension = target === "windows-x64" ? ".exe" : "";
  const expectedName = `dusk-developer-studio-${key}-${version}-${target}-internal-rc${extension}`;
  if (record.mode !== mode || record.name !== expectedName
      || !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || record.bytes > 1_000_000_000
      || !SHA256_RE.test(record.sha256 ?? "")) {
    throw new Error(`${mode} launcher receipt is invalid.`);
  }
}

export function validateStandaloneBuildReceipt(receipt, target) {
  if (!TARGETS.has(target)) throw new Error("Unsupported standalone build-receipt target.");
  exactKeys(receipt, [
    "schema_version", "status", "channel", "target", "version", "commit",
    "embedded_release_fingerprint_sha256", "embedded_runtime_version",
    "contains_second_embedded_runtime", "externalized_runtime", "embedded_file_count",
    "embedded_release_bundle_bytes", "embedded_release_bundle_sha256", "postject_version",
    "platform_signature_status", "embedded_payload_trust", "launchers",
    "unsigned_asset_index_sha256", "executable", "executable_sha256", "executable_bytes"
  ], "Standalone build receipt");
  if (receipt.schema_version !== 3 || receipt.status !== "internal-nonpublication-rc"
      || receipt.channel !== "node-sea-in-process" || receipt.target !== target
      || !VERSION_RE.test(receipt.version ?? "") || !COMMIT_RE.test(receipt.commit ?? "")
      || !SHA256_RE.test(receipt.embedded_release_fingerprint_sha256 ?? "")
      || receipt.embedded_runtime_version !== FROZEN_RUNTIME_VERSION
      || receipt.contains_second_embedded_runtime !== false
      || !Number.isSafeInteger(receipt.embedded_file_count) || receipt.embedded_file_count <= 0 || receipt.embedded_file_count > 50_000
      || !Number.isSafeInteger(receipt.embedded_release_bundle_bytes) || receipt.embedded_release_bundle_bytes <= 0
      || receipt.embedded_release_bundle_bytes > 1_000_000_000
      || !SHA256_RE.test(receipt.embedded_release_bundle_sha256 ?? "")
      || receipt.postject_version !== FROZEN_POSTJECT_VERSION
      || receipt.platform_signature_status !== (target === "darwin-arm64" ? "adhoc-development-only" : "unsigned")) {
    throw new Error("Standalone build receipt identity or frozen toolchain is invalid.");
  }

  exactKeys(receipt.externalized_runtime, ["path", "bytes_removed_from_bundle", "sha256"], "Externalized runtime receipt");
  const expectedRuntimePath = target === "windows-x64" ? "runtime/node.exe" : "runtime/node";
  if (receipt.externalized_runtime.path !== expectedRuntimePath
      || !Number.isSafeInteger(receipt.externalized_runtime.bytes_removed_from_bundle)
      || receipt.externalized_runtime.bytes_removed_from_bundle <= 0
      || receipt.externalized_runtime.bytes_removed_from_bundle > 1_000_000_000
      || !SHA256_RE.test(receipt.externalized_runtime.sha256 ?? "")) {
    throw new Error("Externalized runtime receipt is invalid.");
  }

  exactKeys(receipt.embedded_payload_trust, [
    "portable_manifest_signing_status", "standalone_platform_trust", "publication_eligible"
  ], "Embedded payload trust receipt");
  if (receipt.embedded_payload_trust.portable_manifest_signing_status !== "unsigned-rc"
      || receipt.embedded_payload_trust.standalone_platform_trust !== "not-established"
      || receipt.embedded_payload_trust.publication_eligible !== false) {
    throw new Error("Embedded payload trust receipt overstates candidate trust.");
  }

  exactKeys(receipt.launchers, ["safe", "local_actions"], "Standalone launcher inventory");
  validateLauncher(receipt.launchers.safe, { target, version: receipt.version, key: "safe", mode: "safe" });
  validateLauncher(receipt.launchers.local_actions, {
    target, version: receipt.version, key: "local-actions", mode: "local-actions"
  });
  if (receipt.launchers.safe.name === receipt.launchers.local_actions.name
      || receipt.launchers.safe.sha256 === receipt.launchers.local_actions.sha256
      || receipt.unsigned_asset_index_sha256 !== sha256(canonicalBytes([
        receipt.launchers.safe, receipt.launchers.local_actions
      ]))
      || receipt.executable !== receipt.launchers.safe.name
      || receipt.executable_bytes !== receipt.launchers.safe.bytes
      || receipt.executable_sha256 !== receipt.launchers.safe.sha256) {
    throw new Error("Standalone launcher receipt does not contain the exact dual-launcher asset index.");
  }
  return receipt;
}
