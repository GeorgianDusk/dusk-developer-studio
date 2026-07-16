// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPayload, type PayloadManifest } from "../verifyPayload";

const roots: string[] = [];
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-payload-")); roots.push(root);
  await fs.mkdir(path.join(root, "runtime")); await fs.mkdir(path.join(root, "studio"));
  await fs.writeFile(path.join(root, "runtime", "node.exe"), "runtime");
  await fs.writeFile(path.join(root, "studio", "index.html"), "studio");
  const files = [
    { path: "runtime/node.exe", bytes: 7, sha256: sha("runtime") },
    { path: "studio/index.html", bytes: 6, sha256: sha("studio") }
  ];
  const manifest: PayloadManifest = {
    schema_version: 1, product: "Dusk Developer Studio Local", version: "0.1.0", commit: "a".repeat(40), channel: "portable", target: "windows-x64", signing_status: "unsigned-rc",
    runtime: { name: "node", version: "24.11.0", archive_url: "https://nodejs.org/dist/v24.11.0/node.zip", archive_sha256: "b".repeat(64), binary_path: "runtime/node.exe", binary_sha256: sha("runtime") }, files
  };
  await fs.writeFile(path.join(root, "payload-manifest.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, "SHA256SUMS"), "sidecars\n");
  await fs.writeFile(path.join(root, "companion-provenance.json"), "{}\n");
  await fs.writeFile(path.join(root, "companion-sbom.cdx.json"), "{}\n");
  return root;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("portable payload verification", () => {
  it("accepts an exact declared payload and rejects tampering", async () => {
    const root = await fixture();
    await expect(verifyPayload(root)).resolves.toMatchObject({ channel: "portable", signing_status: "unsigned-rc" });
    await fs.writeFile(path.join(root, "studio", "index.html"), "tampered");
    await expect(verifyPayload(root)).rejects.toThrow(/mismatch/);
  });

  it("rejects undeclared files", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "unexpected.txt"), "x");
    await expect(verifyPayload(root)).rejects.toThrow(/exact file set/);
  });

  it("allows only the declared runtime to be externalized by a matching SEA host", async () => {
    const root = await fixture();
    await fs.rm(path.join(root, "runtime", "node.exe"));
    const externalRuntime = { name: "node" as const, version: "24.11.0", binaryPath: "runtime/node.exe" };
    await expect(verifyPayload(root)).rejects.toThrow(/exact file set/);
    await expect(verifyPayload(root, { externalRuntime })).resolves.toMatchObject({ target: "windows-x64" });
    await expect(verifyPayload(root, { externalRuntime: { ...externalRuntime, version: "24.11.1" } })).rejects.toThrow(/External SEA runtime identity/);
    await fs.writeFile(path.join(root, "runtime", "other.exe"), "runtime");
    await expect(verifyPayload(root, { externalRuntime })).rejects.toThrow(/exact file set/);
  });
});
