// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  duskDsCounterForgeTemplateIdentity,
  renderDuskDsCounterForgeTemplate,
  RUST_2024_RESERVED_PROJECT_IDENTIFIERS,
  scaffoldDuskDsCounterForgeTemplate,
  validateDuskDsCounterProjectName
} from "./duskDsCounterForge";

const templateRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "duskds-counter-forge"
);
const temporaryRoots: string[] = [];

async function makeTemporaryRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const canonicalRoot = await fs.realpath(root);
  temporaryRoots.push(canonicalRoot);
  return canonicalRoot;
}

async function copyRegularTree(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyRegularTree(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
    else throw new Error("Unexpected template fixture entry.");
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("reviewed DuskDS Forge counter template", () => {
  it("uses the Studio's cross-platform Forge-compatible project-name contract", () => {
    for (const valid of [
      "a",
      "counter",
      "counter2",
      "counter-2",
      "a-1-b",
      "a".repeat(80),
      "com10"
    ]) {
      expect(validateDuskDsCounterProjectName(valid).kebab).toBe(valid);
    }
    for (const invalid of [
      "",
      "2counter",
      "Counter",
      "counter_2",
      "counter--2",
      "counter-",
      " counter",
      "counter ",
      "café",
      "counter/2",
      "counter\\2",
      "counter\u0000two",
      "a".repeat(81),
      "con",
      "prn",
      "aux",
      "nul",
      "com1",
      "com9",
      "lpt1",
      "lpt9",
      ...RUST_2024_RESERVED_PROJECT_IDENTIFIERS.map((identifier) =>
        identifier.replaceAll("_", "-")
      )
    ]) {
      expect(() => validateDuskDsCounterProjectName(invalid)).toThrow(
        /Invalid DuskDS project name/
      );
    }
  });

  it("renders one consistent Cargo, Rust module, struct, and WASM identity", async () => {
    const rendered = await renderDuskDsCounterForgeTemplate({
      projectName: "private-counter-2",
      templateRoot
    });
    const byPath = new Map(
      rendered.files.map((file) => [file.path, file.contents.toString("utf8")])
    );
    expect(byPath.get("Cargo.toml")).toMatch(/name = "private-counter-2"/u);
    expect(byPath.get("Cargo.toml")).toMatch(/license = "MPL-2\.0"/u);
    expect(byPath.get("Cargo.toml")).toMatch(/publish = false/u);
    expect(byPath.get("Cargo.lock")).toMatch(
      /\[\[package\]\]\nname = "private-counter-2"\nversion = "0\.1\.0"/u
    );
    expect(byPath.get("Cargo.lock")).toMatch(
      /\[\[package\]\]\nname = "serde_with"\nversion = "3\.21\.0"/u
    );
    expect(byPath.get("Cargo.lock")).toMatch(
      /\[\[package\]\]\nname = "time"\nversion = "0\.3\.53"/u
    );
    expect(byPath.get("Cargo.lock")).not.toMatch(
      /name = "serde_with"\nversion = "3\.17\.0"|name = "time"\nversion = "0\.3\.45"/u
    );
    expect(byPath.get("src/lib.rs")).toContain("mod private_counter_2");
    expect(byPath.get("src/lib.rs")).toContain("pub struct PrivateCounter2");
    expect(byPath.get("tests/contract.rs")).toContain(
      "release/private_counter_2.wasm"
    );
    expect(byPath.get("rust-toolchain.toml")).toMatch(
      /^\[toolchain\]\nchannel = "1\.94\.0"$/mu
    );
    expect(byPath.get("README.md")).toMatch(/example starter is not audited/u);
    expect(byPath.get("Makefile")).not.toMatch(/cargo metadata|\bjq\b/u);
    expect(byPath.get("Makefile")).toContain(
      "CRATE_NAME_DASHED := private-counter-2"
    );
    expect(byPath.get("Makefile")).toContain(
      "CONTRACT_TARGET_DIR := target/contract"
    );
    expect(byPath.get("Makefile")).toContain(
      "DD_TARGET_DIR := target/data-driver"
    );
    expect(byPath.get("Makefile")).toMatch(/cargo build \\\n\s+--locked/u);
    expect(byPath.get("Makefile")).toMatch(/cargo test --locked --release/u);
    expect(byPath.get("Makefile")).toMatch(/cargo clippy \\\n\s+--locked/u);
    expect(byPath.get("Makefile")).toMatch(/cargo expand --locked/u);
    expect(byPath.get("Makefile")).toMatch(/cargo doc --locked --release/u);
    expect(byPath.get("Makefile")).toContain(
      'CARGO_TARGET_DIR="$(CONTRACT_TARGET_DIR)"'
    );
    expect(byPath.get("Makefile")).toContain(
      'CARGO_TARGET_DIR="$(DD_TARGET_DIR)"'
    );
    expect(byPath.get("Makefile")).toContain(
      'wasm-opt $(WASM_OPT_LEVEL) --strip-debug "$(1)" -o "$(1)"'
    );
    expect(byPath.get("Makefile")).toMatch(/^test: wasm /mu);
    expect(byPath.get("Makefile")).not.toMatch(
      /rm\s+-rf|:=\s*\/target|\$\(CURDIR\)|cargo metadata|\bjq\b/u
    );
    expect(byPath.get("Makefile")).toMatch(
      /^clean:.*\n\t@cargo clean$/mu
    );
    expect(byPath.get("Makefile")).not.toMatch(
      /^\$\(CONTRACT_WASM_FILE\):|^\$\(DD_WASM_FILE\):/mu
    );
    expect(byPath.get("PROVENANCE.md")).toContain(
      duskDsCounterForgeTemplateIdentity.upstreamRevision
    );
    expect(byPath.get("LICENSE-MPL-2.0.txt")).toMatch(
      /^Mozilla Public License Version 2\.0/u
    );
    expect(rendered.files.map((file) => file.path)).toEqual([
      ".gitignore",
      "Cargo.lock",
      "Cargo.toml",
      "LICENSE-MPL-2.0.txt",
      "Makefile",
      "PROVENANCE.md",
      "README.md",
      "rust-toolchain.toml",
      "src/lib.rs",
      "tests/contract.rs"
    ]);

    const sentinelPrefix = await renderDuskDsCounterForgeTemplate({
      projectName: "dusk-studio-template-project-2",
      templateRoot
    });
    const sentinelFiles = new Map(
      sentinelPrefix.files.map((file) => [file.path, file.contents.toString("utf8")])
    );
    expect(sentinelFiles.get("Cargo.toml")).toMatch(
      /name = "dusk-studio-template-project-2"/u
    );
    expect(sentinelFiles.get("src/lib.rs")).toContain(
      "mod dusk_studio_template_project_2"
    );
  });

  it("pins the reviewed lock and rejects dependency drift before writing", async () => {
    const fixture = await makeTemporaryRoot("duskds-template-tamper-");
    await copyRegularTree(templateRoot, fixture);
    await fs.appendFile(path.join(fixture, "Cargo.lock"), "\n# tampered\n", "utf8");
    await expect(
      renderDuskDsCounterForgeTemplate({
        projectName: "counter",
        templateRoot: fixture
      })
    ).rejects.toThrow(/Cargo\.lock does not match the reviewed dependency resolution/u);
  });

  it("accepts a canonicalized package-root link while rejecting unreviewed children", async () => {
    const fixture = await makeTemporaryRoot("duskds-template-link-");
    const linkedRoot = path.join(fixture, "linked-template");
    await fs.symlink(
      templateRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(
      renderDuskDsCounterForgeTemplate({
        projectName: "linked-counter",
        templateRoot: linkedRoot
      })
    ).resolves.toMatchObject({
      projectName: { kebab: "linked-counter" }
    });

    const extraRoot = path.join(fixture, "extra-template");
    await copyRegularTree(templateRoot, extraRoot);
    await fs.writeFile(path.join(extraRoot, "UNREVIEWED.txt"), "no\n", "utf8");
    await expect(
      renderDuskDsCounterForgeTemplate({
        projectName: "linked-counter",
        templateRoot: extraRoot
      })
    ).rejects.toThrow(/file inventory does not match/u);
  });

  it("scaffolds only into a new child and never overwrites it", async () => {
    const parent = await makeTemporaryRoot("duskds-template-parent-");
    const first = await scaffoldDuskDsCounterForgeTemplate({
      projectName: "counter-safe",
      projectParent: parent,
      templateRoot
    });
    expect(first.path).toBe(path.join(parent, "counter-safe"));
    expect(
      createHash("sha256")
        .update(await fs.readFile(path.join(first.path, "Cargo.lock")))
        .digest("hex")
    ).toBe("375e5b2e373a378afce7cec91b6f287a53ccb0844c3435827eb8543aaa527d86");
    await expect(
      scaffoldDuskDsCounterForgeTemplate({
        projectName: "counter-safe",
        projectParent: parent,
        templateRoot
      })
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(
      fs.readFile(path.join(first.path, ".gitignore"), "utf8")
    ).resolves.toBe("# Build artifacts\n/target/\n");
  });
});
