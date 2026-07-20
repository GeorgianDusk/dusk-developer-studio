import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  compareCodePoints,
  npmOutputRoot,
  npmPackageName,
  npmPackageRoot,
  npmPackageVersion,
  readGitIdentity,
  resolveNpmCli,
  runFile,
  verifyBuiltNpmPackage,
  writeJson
} from "./npm-package-core.mjs";

const allowedArguments = new Set(["--allow-dirty"]);
const unknown = process.argv.slice(2).filter((argument) => !allowedArguments.has(argument));
if (unknown.length) throw new Error(`Unsupported npm pack argument: ${unknown[0]}.`);
const allowDirty = process.argv.includes("--allow-dirty");
const git = readGitIdentity();
if (!git.clean && !allowDirty) {
  throw new Error("The npm release tarball must be packed from a clean Git worktree.");
}

const verified = await verifyBuiltNpmPackage(npmPackageRoot, {
  expectedCommit: git.commit,
  expectedVersion: npmPackageVersion
});
const expectedTarball = `${npmPackageName}-${npmPackageVersion}.tgz`;
const tarballPath = path.join(npmOutputRoot, expectedTarball);
await fs.rm(tarballPath, { force: true });

const npmCli = await resolveNpmCli();
const result = await runFile(
  process.execPath,
  [npmCli, "pack", "--ignore-scripts", "--json", "--pack-destination", npmOutputRoot],
  { cwd: npmPackageRoot, capture: true }
);
const records = JSON.parse(result.stdout);
if (!Array.isArray(records) || records.length !== 1) {
  throw new Error("npm pack did not return exactly one package record.");
}
const record = records[0];
if (
  record.id !== `${npmPackageName}@${npmPackageVersion}`
  || record.name !== npmPackageName
  || record.version !== npmPackageVersion
  || record.filename !== expectedTarball
  || typeof record.integrity !== "string"
  || !record.integrity.startsWith("sha512-")
  || !Array.isArray(record.files)
) {
  throw new Error("npm pack returned an unexpected package identity.");
}
const expectedFiles = [
  ...verified.manifest.files.map((file) => file.path),
  "package-manifest.json"
].sort(compareCodePoints);
const packedFiles = record.files
  .map((file) => file.path)
  .sort(compareCodePoints);
if (JSON.stringify(packedFiles) !== JSON.stringify(expectedFiles)) {
  const missing = expectedFiles.filter((file) => !packedFiles.includes(file));
  const extra = packedFiles.filter((file) => !expectedFiles.includes(file));
  throw new Error(
    `The tarball does not match the verified package directory. Missing: ${missing.join(", ") || "none"}. `
    + `Extra: ${extra.join(", ") || "none"}.`
  );
}
if (
  !packedFiles.includes("templates/foundry-counter-dusk-evm/.env.example")
  || !packedFiles.includes("templates/duskds-counter-forge/Cargo.lock")
  || !packedFiles.includes("templates/duskds-counter-forge/LICENSE-MPL-2.0.txt")
  || !packedFiles.includes("templates/duskds-counter-forge/PROVENANCE.md")
  || !packedFiles.includes("templates/duskds-counter-forge/.gitignore.template")
  || packedFiles.some((file) => file.endsWith("/.gitignore") || file.endsWith("/AGENTS.md"))
) {
  throw new Error("The tarball template inventory is not safe for npm distribution.");
}
const bytes = await fs.readFile(tarballPath);
const computedIntegrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
if (record.integrity !== computedIntegrity) {
  throw new Error("npm pack integrity does not match the final tarball bytes.");
}

if (process.platform === "win32") {
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-studio-npm-cmd-"));
  try {
    await fs.writeFile(
      path.join(smokeRoot, "package.json"),
      `${JSON.stringify({ name: "dusk-studio-cmd-smoke", private: true })}\n`,
      "utf8"
    );
    await runFile(
      process.execPath,
      [
        npmCli,
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarballPath
      ],
      { cwd: smokeRoot, capture: true }
    );
    const shim = path.join(smokeRoot, "node_modules", ".bin", "dusk-developer-studio.cmd");
    const smoke = await runFile(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "call \"%DUSK_STUDIO_NPM_SHIM%\" --version"],
      {
        cwd: smokeRoot,
        capture: true,
        env: { ...process.env, DUSK_STUDIO_NPM_SHIM: shim },
        windowsVerbatimArguments: true
      }
    );
    if (smoke.stdout.trim() !== npmPackageVersion) {
      throw new Error("The generated Windows npm command shim returned an unexpected version.");
    }
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true });
  }
}

const receipt = {
  schema_version: 1,
  package: npmPackageName,
  version: npmPackageVersion,
  commit: git.commit,
  channel: "npm",
  filename: expectedTarball,
  bytes: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  integrity: computedIntegrity,
  files: packedFiles.length,
  clean_worktree: git.clean
};
await writeJson(path.join(npmOutputRoot, "pack-receipt.json"), receipt);
console.log(JSON.stringify(receipt, null, 2));
