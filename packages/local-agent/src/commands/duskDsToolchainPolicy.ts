import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import policy from "../../../../config/duskds-toolchain-policy.json";

const FORTY_HEX_RE = /^[0-9a-f]{40}$/;
const SAFE_PACKAGE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SAFE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

function requirePolicyValue(value: unknown, label: string, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) {
    throw new Error(`DuskDS toolchain policy has an invalid ${label}.`);
  }
  return value;
}

export const DUSKDS_RUST_TOOLCHAIN = requirePolicyValue(
  policy.rust_toolchain,
  "Rust toolchain",
  /^\d+\.\d+\.\d+$/
);
export const DUSK_FORGE_REPOSITORY = requirePolicyValue(
  policy.dusk_forge.repository,
  "Dusk Forge repository",
  /^https:\/\/github\.com\/dusk-network\/forge$/
);
export const DUSK_FORGE_PACKAGE = requirePolicyValue(
  policy.dusk_forge.package,
  "Dusk Forge package",
  SAFE_PACKAGE_RE
);
export const DUSK_FORGE_BINARY = requirePolicyValue(
  policy.dusk_forge.binary,
  "Dusk Forge binary",
  SAFE_PACKAGE_RE
);
export const DUSK_FORGE_REVISION = requirePolicyValue(
  policy.dusk_forge.revision,
  "Dusk Forge revision",
  FORTY_HEX_RE
);

if (policy.schema_version !== 1) {
  throw new Error("DuskDS toolchain policy schema is unsupported.");
}

export const DUSK_FORGE_INSTALL_COMMAND = [
  "cargo",
  `+${DUSKDS_RUST_TOOLCHAIN}`,
  "install",
  "--locked",
  "--force",
  "--git",
  DUSK_FORGE_REPOSITORY,
  "--rev",
  DUSK_FORGE_REVISION,
  DUSK_FORGE_PACKAGE
].join(" ");

export interface DuskForgeInstallIdentity {
  package: string;
  packageVersion: string;
  binary: string;
  repository: string;
  revision: string;
}

interface CargoInstallRecord {
  bins?: unknown;
}

interface CargoInstallMetadata {
  installs?: Record<string, CargoInstallRecord>;
}

export function resolveCargoHome(cargoHome?: string): string {
  return path.resolve(cargoHome?.trim() || process.env.CARGO_HOME?.trim() || path.join(homedir(), ".cargo"));
}

export function resolveCargoInstallRoot(cargoInstallRoot?: string): string {
  return path.resolve(cargoInstallRoot?.trim() || process.env.CARGO_INSTALL_ROOT?.trim() || resolveCargoHome());
}

export function reviewedDuskForgeBinDirectory(cargoInstallRoot?: string): string {
  return path.join(resolveCargoInstallRoot(cargoInstallRoot), "bin");
}

export function reviewedDuskForgeExecutable(cargoInstallRoot?: string): string {
  return path.join(reviewedDuskForgeBinDirectory(cargoInstallRoot), process.platform === "win32" ? "dusk-forge.exe" : "dusk-forge");
}

function parseCargoPackageId(packageId: string): {
  package: string;
  packageVersion: string;
  repository: string;
  revision: string;
} | undefined {
  const match = /^([a-z0-9][a-z0-9_-]*)\s+v?([A-Za-z0-9][A-Za-z0-9.+_-]{0,63})\s+\((git\+[^)]+)\)$/.exec(packageId);
  if (!match) return undefined;
  const [, packageName, packageVersion, source] = match;
  const sourceMatch = /^git\+(https:\/\/github\.com\/dusk-network\/forge(?:\.git)?)(?:\?[^#)]*)?#([0-9a-f]{40})$/.exec(source);
  if (!sourceMatch) return undefined;
  return {
    package: packageName,
    packageVersion,
    repository: sourceMatch[1].replace(/\.git$/, ""),
    revision: sourceMatch[2]
  };
}

export function parseDuskForgeCargoInstallMetadata(raw: string): DuskForgeInstallIdentity {
  let metadata: CargoInstallMetadata;
  try {
    metadata = JSON.parse(raw) as CargoInstallMetadata;
  } catch {
    throw new Error("Cargo install metadata is not valid JSON.");
  }
  if (!metadata.installs || typeof metadata.installs !== "object" || Array.isArray(metadata.installs)) {
    throw new Error("Cargo install metadata does not contain an installs record.");
  }

  for (const [packageId, record] of Object.entries(metadata.installs)) {
    const parsed = parseCargoPackageId(packageId);
    if (!parsed || parsed.package !== DUSK_FORGE_PACKAGE) continue;
    const bins = Array.isArray(record?.bins) ? record.bins.filter((value): value is string => typeof value === "string") : [];
    const trackedBinary = process.platform === "win32" ? `${DUSK_FORGE_BINARY}.exe` : DUSK_FORGE_BINARY;
    if (!bins.includes(trackedBinary) && !bins.includes(DUSK_FORGE_BINARY)) continue;
    if (parsed.repository !== DUSK_FORGE_REPOSITORY || parsed.revision !== DUSK_FORGE_REVISION) {
      throw new Error("Installed Dusk Forge does not match the reviewed source revision.");
    }
    return { ...parsed, binary: DUSK_FORGE_BINARY };
  }

  throw new Error("No Cargo install receipt was found for the reviewed Dusk Forge revision.");
}

export async function readReviewedDuskForgeIdentity(
  options: { cargoInstallRoot?: string; readFile?: typeof fs.readFile } = {}
): Promise<DuskForgeInstallIdentity> {
  const cargoInstallRoot = resolveCargoInstallRoot(options.cargoInstallRoot);
  const readFile = options.readFile ?? fs.readFile;
  const raw = await readFile(path.join(cargoInstallRoot, ".crates2.json"), "utf8");
  return parseDuskForgeCargoInstallMetadata(raw);
}

export function assertReviewedDuskForgeIdentity(identity: DuskForgeInstallIdentity): DuskForgeInstallIdentity {
  if (
    identity.package !== DUSK_FORGE_PACKAGE
    || !SAFE_VERSION_RE.test(identity.packageVersion)
    || identity.binary !== DUSK_FORGE_BINARY
    || identity.repository !== DUSK_FORGE_REPOSITORY
    || identity.revision !== DUSK_FORGE_REVISION
  ) {
    throw new Error("Installed Dusk Forge does not match the reviewed source revision.");
  }
  return identity;
}
