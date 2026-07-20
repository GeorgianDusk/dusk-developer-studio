import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import toolchainPolicy from "../../../config/duskds-toolchain-policy.json";

const TEMPLATE_PROJECT_NAME = "dusk-studio-template-project";
const TEMPLATE_MODULE_NAME = "dusk_studio_template_project";
const TEMPLATE_STRUCT_NAME = "DuskStudioTemplateProject";
const PROJECT_NAME_RE = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,79}$/;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
export const RUST_2024_RESERVED_PROJECT_IDENTIFIERS = Object.freeze([
  "abstract",
  "as",
  "async",
  "await",
  "become",
  "box",
  "break",
  "const",
  "continue",
  "crate",
  "do",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "final",
  "fn",
  "for",
  "gen",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "macro",
  "macro_rules",
  "match",
  "mod",
  "move",
  "mut",
  "override",
  "priv",
  "pub",
  "raw",
  "ref",
  "return",
  "safe",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "try",
  "type",
  "typeof",
  "union",
  "unsafe",
  "unsized",
  "use",
  "virtual",
  "where",
  "while",
  "yield"
] as const);
const RUST_2024_RESERVED_PROJECT_IDENTIFIER_SET = new Set<string>(
  RUST_2024_RESERVED_PROJECT_IDENTIFIERS
);
const GENERATED_LOCK_SHA256 = toolchainPolicy.dusk_forge.reviewed_template.generated_lock_sha256;

// Set after the WSL-generated lock is normalized from the pilot identity to the
// valid template identity above. Keeping this hash here makes lock drift fail
// closed before any project files are written.
const TEMPLATE_LOCK_SHA256 = toolchainPolicy.dusk_forge.reviewed_template.template_lock_sha256;

const TEMPLATE_FILE_MAPPINGS = Object.freeze([
  [".gitignore.template", ".gitignore", false],
  ["Cargo.lock", "Cargo.lock", true],
  ["Cargo.toml", "Cargo.toml", true],
  ["LICENSE-MPL-2.0.txt", "LICENSE-MPL-2.0.txt", false],
  ["Makefile", "Makefile", true],
  ["PROVENANCE.md", "PROVENANCE.md", false],
  ["README.md", "README.md", false],
  ["rust-toolchain.toml", "rust-toolchain.toml", false],
  ["src/lib.rs", "src/lib.rs", true],
  ["tests/contract.rs", "tests/contract.rs", true]
] as const);

const MAX_TEMPLATE_FILE_BYTES = 1024 * 1024;

export interface DuskDsCounterProjectName {
  kebab: string;
  module: string;
  pascal: string;
}

export interface RenderedDuskDsCounterFile {
  path: string;
  contents: Buffer;
}

export interface RenderDuskDsCounterOptions {
  projectName: string;
  templateRoot: string;
}

export interface ScaffoldDuskDsCounterOptions extends RenderDuskDsCounterOptions {
  projectParent: string;
}

export interface ScaffoldedDuskDsCounter {
  path: string;
  files: string[];
  projectName: DuskDsCounterProjectName;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function projectNameError(name: string, reason: string): Error {
  return new Error(`Invalid DuskDS project name ${JSON.stringify(name)}: ${reason}.`);
}

export function validateDuskDsCounterProjectName(name: string): DuskDsCounterProjectName {
  if (!name) throw projectNameError(name, "name cannot be empty");
  if (!PROJECT_NAME_RE.test(name)) {
    throw projectNameError(
      name,
      "use 1-80 characters, start with a lowercase ASCII letter, and use only lowercase ASCII letters, digits, or single internal hyphens"
    );
  }
  if (WINDOWS_RESERVED_NAME_RE.test(name)) {
    throw projectNameError(name, "name is reserved on Windows");
  }

  const module = name.replaceAll("-", "_");
  if (RUST_2024_RESERVED_PROJECT_IDENTIFIER_SET.has(module)) {
    throw projectNameError(name, "generated module name is reserved by Rust 2024");
  }
  const pascal = name
    .split("-")
    .map((segment) => `${segment[0].toUpperCase()}${segment.slice(1)}`)
    .join("");
  return { kebab: name, module, pascal };
}

async function walkTemplateFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true }))
    .sort((left, right) => compareCodePoints(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`DuskDS template contains a symbolic link: ${entry.name}.`);
    }
    if (stat.isDirectory()) {
      files.push(...await walkTemplateFiles(root, absolute));
    } else if (stat.isFile()) {
      if (stat.size > MAX_TEMPLATE_FILE_BYTES) {
        throw new Error(`DuskDS template file exceeds its size limit: ${entry.name}.`);
      }
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    } else {
      throw new Error(`DuskDS template contains an unsupported filesystem entry: ${entry.name}.`);
    }
  }
  return files.sort(compareCodePoints);
}

async function readTrustedTemplateRoot(templateRoot: string): Promise<Map<string, Buffer>> {
  const requestedRoot = path.resolve(templateRoot);
  const realRoot = await fs.realpath(requestedRoot);
  const rootStat = await fs.lstat(realRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("DuskDS template root must be a real directory.");
  }

  const expected = TEMPLATE_FILE_MAPPINGS
    .map(([source]) => source)
    .sort(compareCodePoints);
  const actual = await walkTemplateFiles(realRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("DuskDS template file inventory does not match the reviewed asset.");
  }

  const files = new Map<string, Buffer>();
  for (const relative of expected) {
    const absolute = path.join(realRoot, ...relative.split("/"));
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`DuskDS template file is not a regular file: ${relative}.`);
    }
    files.set(relative, await fs.readFile(absolute));
  }

  const lock = files.get("Cargo.lock");
  if (!lock || sha256(lock) !== TEMPLATE_LOCK_SHA256) {
    throw new Error("DuskDS template Cargo.lock does not match the reviewed dependency resolution.");
  }
  return files;
}

function replaceText(contents: Buffer, replacements: ReadonlyArray<readonly [string, string]>): Buffer {
  let rendered = contents.toString("utf8");
  for (const [from, to] of replacements) rendered = rendered.replaceAll(from, to);
  return Buffer.from(rendered, "utf8");
}

function packageNameFromCargoToml(contents: Buffer): string {
  const text = contents.toString("utf8");
  const sectionStart = text.indexOf("[package]\n");
  if (sectionStart < 0) throw new Error("Rendered DuskDS Cargo.toml has no package section.");
  const afterHeader = text.slice(sectionStart + "[package]\n".length);
  const nextSection = afterHeader.search(/^\[/mu);
  const packageSection = nextSection < 0 ? afterHeader : afterHeader.slice(0, nextSection);
  const packageName = packageSection
    ? /^name\s*=\s*"([^"]+)"\s*$/mu.exec(packageSection)?.[1]
    : undefined;
  if (!packageName) throw new Error("Rendered DuskDS Cargo.toml has no root package name.");
  return packageName;
}

function rootNameFromCargoLock(contents: Buffer): string {
  const records = contents.toString("utf8").split(/\n(?=\[\[package\]\]\n)/u);
  const matching = records.filter((record) =>
    /^name\s*=\s*"[^"]+"\s*$/mu.test(record)
    && /^version\s*=\s*"0\.1\.0"\s*$/mu.test(record)
    && /"dusk-forge"/u.test(record)
    && /"dusk-vm"/u.test(record)
  );
  if (matching.length !== 1) {
    throw new Error("Rendered DuskDS Cargo.lock does not contain exactly one root package record.");
  }
  const rootName = /^name\s*=\s*"([^"]+)"\s*$/mu.exec(matching[0])?.[1];
  if (!rootName) throw new Error("Rendered DuskDS Cargo.lock root package name is missing.");
  return rootName;
}

function assertRenderedIdentity(
  files: RenderedDuskDsCounterFile[],
  projectName: DuskDsCounterProjectName
): void {
  const byPath = new Map(files.map((file) => [file.path, file.contents]));
  const cargoToml = byPath.get("Cargo.toml");
  const cargoLock = byPath.get("Cargo.lock");
  const library = byPath.get("src/lib.rs")?.toString("utf8");
  const contractTest = byPath.get("tests/contract.rs")?.toString("utf8");
  const makefile = byPath.get("Makefile")?.toString("utf8");
  if (!cargoToml || !cargoLock || !library || !contractTest || !makefile) {
    throw new Error("Rendered DuskDS project identity files are incomplete.");
  }
  if (
    packageNameFromCargoToml(cargoToml) !== projectName.kebab
    || rootNameFromCargoLock(cargoLock) !== projectName.kebab
  ) {
    throw new Error("Rendered DuskDS Cargo.toml and Cargo.lock package names do not match.");
  }
  if (
    /^mod ([a-z][a-z0-9_]*) \{$/mu.exec(library)?.[1] !== projectName.module
    || /^\s*pub struct ([A-Z][A-Za-z0-9]*) \{$/mu.exec(library)?.[1] !== projectName.pascal
    || /release\/([a-z][a-z0-9_]*)\.wasm/u.exec(contractTest)?.[1] !== projectName.module
    || /^CRATE_NAME_DASHED := ([a-z][a-z0-9-]*)$/mu.exec(makefile)?.[1]
      !== projectName.kebab
  ) {
    throw new Error("Rendered DuskDS Rust and WASM identities do not match the project name.");
  }
}

export async function renderDuskDsCounterForgeTemplate(
  options: RenderDuskDsCounterOptions
): Promise<{ files: RenderedDuskDsCounterFile[]; projectName: DuskDsCounterProjectName }> {
  const projectName = validateDuskDsCounterProjectName(options.projectName);
  const source = await readTrustedTemplateRoot(options.templateRoot);
  const replacements = [
    [TEMPLATE_PROJECT_NAME, projectName.kebab],
    [TEMPLATE_MODULE_NAME, projectName.module],
    [TEMPLATE_STRUCT_NAME, projectName.pascal]
  ] as const;
  const files = TEMPLATE_FILE_MAPPINGS.map(([sourcePath, outputPath, renderIdentity]) => {
    const contents = source.get(sourcePath);
    if (!contents) throw new Error(`DuskDS template file is missing: ${sourcePath}.`);
    return {
      path: outputPath,
      contents: renderIdentity ? replaceText(contents, replacements) : contents
    };
  });
  assertRenderedIdentity(files, projectName);
  return { files, projectName };
}

export async function scaffoldDuskDsCounterForgeTemplate(
  options: ScaffoldDuskDsCounterOptions
): Promise<ScaffoldedDuskDsCounter> {
  const rendered = await renderDuskDsCounterForgeTemplate(options);
  const requestedParent = path.resolve(options.projectParent);
  const realParent = await fs.realpath(requestedParent);
  if (realParent !== requestedParent) {
    throw new Error("DuskDS scaffold parent must use its canonical filesystem path.");
  }
  const parentStat = await fs.lstat(realParent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("DuskDS scaffold parent must be a real directory.");
  }

  const destination = path.join(realParent, rendered.projectName.kebab);
  await fs.mkdir(destination, { recursive: false, mode: 0o700 });
  // The trusted caller owns cleanup of its bounded staging directory. This
  // helper deliberately never recursively deletes a path after a write error.
  for (const file of rendered.files) {
    const output = path.join(destination, ...file.path.split("/"));
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await fs.writeFile(output, file.contents, { flag: "wx", mode: 0o600 });
  }

  return {
    path: destination,
    files: rendered.files.map((file) => file.path),
    projectName: rendered.projectName
  };
}

export const duskDsCounterForgeTemplateIdentity = Object.freeze({
  templateId: toolchainPolicy.dusk_forge.reviewed_template.id,
  upstreamRepository: "https://github.com/dusk-network/forge",
  upstreamRevision: "d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a",
  generatedLockSha256: GENERATED_LOCK_SHA256,
  templateLockSha256: TEMPLATE_LOCK_SHA256,
  rustToolchain: "1.94.0",
  templateProjectName: TEMPLATE_PROJECT_NAME
});
