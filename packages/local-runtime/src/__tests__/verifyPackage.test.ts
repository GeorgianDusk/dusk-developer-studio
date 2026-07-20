// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSupportedNodeVersion,
  verifyNpmPackage,
  type NpmPackageManifest
} from "../verifyPackage";

const roots: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-npm-package-test-"));
  roots.push(root);
  const files = new Map<string, string>([
    ["LICENSE", "license"],
    ["NOTICE", "notice"],
    ["README.md", "readme"],
    ["THIRD-PARTY-LICENSES.txt", "third-party licenses"],
    ["app/runtime.mjs", "runtime"],
    ["bin/dusk-developer-studio.mjs", "main"],
    ["studio/assets/app.css", "body { color: white; }\n"],
    ["studio/assets/app.js", "document.documentElement.dataset.booted = 'true';\n"],
    ["studio/index.html", "<!doctype html><link rel=\"stylesheet\" href=\"/assets/app.css\"><script type=\"module\" src=\"/assets/app.js\"></script>"],
    ["templates/foundry-counter-dusk-evm/.env.example", "DUSK_EVM_TESTNET_RPC_URL=\n"],
    ["templates/foundry-counter-dusk-evm/.gitignore.template", "broadcast/\ncache/\n"],
    ["templates/foundry-counter-dusk-evm/README.md", "# Counter\n"],
    ["templates/foundry-counter-dusk-evm/foundry.toml", "[profile.default]"],
    ["templates/foundry-counter-dusk-evm/src/Counter.sol", "contract Counter {}\n"],
    ["templates/foundry-counter-dusk-evm/test/Counter.t.sol", "contract CounterTest {}\n"],
    ["templates/duskds-counter-forge/.gitignore.template", "/target/\n"],
    ["templates/duskds-counter-forge/Cargo.lock", "version = 4\n"],
    ["templates/duskds-counter-forge/Cargo.toml", "[package]\nname = \"counter\"\n"],
    ["templates/duskds-counter-forge/LICENSE-MPL-2.0.txt", "Mozilla Public License Version 2.0\n"],
    ["templates/duskds-counter-forge/Makefile", "all: wasm\n"],
    ["templates/duskds-counter-forge/PROVENANCE.md", "# Template provenance\n"],
    ["templates/duskds-counter-forge/README.md", "# DuskDS counter starter\n"],
    ["templates/duskds-counter-forge/rust-toolchain.toml", "[toolchain]\nchannel = \"1.94.0\"\n"],
    ["templates/duskds-counter-forge/src/lib.rs", "#![no_std]\n"],
    ["templates/duskds-counter-forge/tests/contract.rs", "#[test]\nfn contract() {}\n"]
  ]);
  const packageJson = {
    name: "dusk-developer-studio",
    version: "1.0.0",
    description: "Local developer Studio for DuskEVM reference and DuskDS workflows.",
    author: "GeorgianDusk",
    keywords: ["dusk", "duskevm", "duskds", "developer-tools", "blockchain"],
    license: "Apache-2.0",
    type: "module",
    repository: {
      type: "git",
      url: "git+https://github.com/GeorgianDusk/dusk-developer-studio.git"
    },
    homepage: "https://github.com/GeorgianDusk/dusk-developer-studio#readme",
    bugs: { url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues" },
    engines: { node: ">=24.18.0 <25" },
    bin: {
      "dusk-developer-studio": "bin/dusk-developer-studio.mjs"
    },
    files: [
      "app",
      "bin",
      "studio",
      "templates",
      "package-manifest.json",
      "README.md",
      "LICENSE",
      "NOTICE",
      "THIRD-PARTY-LICENSES.txt"
    ],
    publishConfig: { access: "public", provenance: true }
  };
  files.set("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  for (const [relative, contents] of files) {
    const destination = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  const records = [...files.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([relative, contents]) => ({
      path: relative,
      bytes: Buffer.byteLength(contents),
      sha256: sha(contents)
    }));
  const manifest: NpmPackageManifest = {
    schema_version: 1,
    product: "Dusk Developer Studio Local",
    package: "dusk-developer-studio",
    version: "1.0.0",
    commit: "a".repeat(40),
    channel: "npm",
    node: { required_range: ">=24.18.0 <25" },
    supported_targets: ["windows-x64", "linux-x64", "darwin-arm64"],
    files: records
  };
  await fs.writeFile(
    path.join(root, "package-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("npm package verification", () => {
  it("accepts an exact package and rejects tampering", async () => {
    const root = await fixture();
    await expect(verifyNpmPackage(root, {
      nodeVersion: "24.18.0",
      platform: "win32",
      architecture: "x64"
    })).resolves.toMatchObject({ package: "dusk-developer-studio", channel: "npm" });
    const manifest = JSON.parse(await fs.readFile(path.join(root, "package-manifest.json"), "utf8"));
    expect(manifest.files.map((record: { path: string }) => record.path).slice(0, 4)).toEqual([
      "LICENSE",
      "NOTICE",
      "README.md",
      "THIRD-PARTY-LICENSES.txt"
    ]);
    await fs.writeFile(path.join(root, "app", "runtime.mjs"), "tampered");
    await expect(verifyNpmPackage(root, {
      nodeVersion: "24.18.0",
      platform: "win32",
      architecture: "x64"
    })).rejects.toThrow(/does not match/);
  });

  it("canonicalizes a symlinked package root while verifying the exact manifest", async () => {
    const root = await fixture();
    const linkParent = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-npm-package-link-"));
    roots.push(linkParent);
    const linkedRoot = path.join(linkParent, "linked-package");
    await fs.symlink(root, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    await expect(verifyNpmPackage(linkedRoot, {
      nodeVersion: "24.18.0",
      platform: "linux",
      architecture: "x64"
    })).resolves.toMatchObject({ package: "dusk-developer-studio", channel: "npm" });
  });

  it("rejects a browser index that references a missing bundle asset", async () => {
    const root = await fixture();
    await fs.writeFile(
      path.join(root, "studio", "index.html"),
      "<!doctype html><link rel=\"stylesheet\" href=\"/assets/app.css\"><script type=\"module\" src=\"/assets/missing.js\"></script>"
    );
    await expect(verifyNpmPackage(root, {
      nodeVersion: "24.18.0",
      platform: "linux",
      architecture: "x64"
    })).rejects.toThrow(/missing or empty asset/);
  });

  it("rejects undeclared files, lifecycle scripts, and unsupported hosts", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "undeclared.txt"), "no");
    await expect(verifyNpmPackage(root, {
      nodeVersion: "24.18.0",
      platform: "linux",
      architecture: "x64"
    })).rejects.toThrow(/exact file set/);
    await fs.rm(path.join(root, "undeclared.txt"));

    const packagePath = path.join(root, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
    packageJson.scripts = { install: "node install.mjs" };
    await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await expect(verifyNpmPackage(root, {
      nodeVersion: "24.18.0",
      platform: "linux",
      architecture: "x64"
    })).rejects.toThrow(/dependencies or lifecycle scripts|does not match/);

    const fresh = await fixture();
    await expect(verifyNpmPackage(fresh, {
      nodeVersion: "24.18.0",
      platform: "darwin",
      architecture: "x64"
    })).rejects.toThrow(/supports Windows x64/);
  });

  it("enforces Node 24.18 or newer within major 24", () => {
    expect(() => assertSupportedNodeVersion("24.17.9")).toThrow(/requires Node/);
    expect(() => assertSupportedNodeVersion("23.99.0")).toThrow(/requires Node/);
    expect(() => assertSupportedNodeVersion("25.0.0")).toThrow(/requires Node/);
    expect(() => assertSupportedNodeVersion("24.18.0")).not.toThrow();
    expect(() => assertSupportedNodeVersion("24.19.2")).not.toThrow();
  });
});
