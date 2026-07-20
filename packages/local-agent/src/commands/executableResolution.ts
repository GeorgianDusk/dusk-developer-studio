import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  realpathSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface FileIdentity {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface ExecutableResolutionProbe {
  platform?: NodeJS.Platform;
  inheritedCwd?: string;
  homeDirectory?: string;
  systemRoot?: string;
  trustedPathDirectories?: string[];
  access?(file: string, mode: number): void;
  lstat?(file: string): FileIdentity;
  realpath?(file: string): string;
}

export interface ExecutableSearchPathOptions {
  platform?: NodeJS.Platform;
  excludedRoots?: string[];
  excludedPaths?: string[];
}

export interface LaunchPathExclusions {
  excludedRoots: string[];
  excludedPaths: string[];
}

export interface LaunchPathExclusionProbe {
  realpath?(file: string): string;
}

const WINDOWS_ROOT_EXECUTABLES = new Set(["explorer.exe"]);
const WINDOWS_SYSTEM32_EXECUTABLES = new Set([
  "cmd.exe",
  "netstat.exe",
  "taskkill.exe",
  "where.exe",
  "whoami.exe",
  "wsl.exe"
]);
const SAFE_WINDOWS_EXECUTABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const SAFE_POSIX_EXECUTABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const FORBIDDEN_PATH_CHARACTERS = /[\0\r\n<>"|?*]/;

function platformPath(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function comparisonKey(value: string, platform: NodeJS.Platform): string {
  const normalized = platformPath(platform).normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(candidate: string, root: string, platform: NodeJS.Platform): boolean {
  const pathApi = platformPath(platform);
  const relative = pathApi.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

function isProjectScopedShim(value: string, platform: NodeJS.Platform): boolean {
  const normalized = comparisonKey(value, platform);
  const separator = platform === "win32" ? "\\" : "/";
  return normalized.split(separator).some((segment, index, segments) =>
    segment === ".bin" && index > 0 && segments[index - 1] === "node_modules"
  );
}

function stripBalancedQuotes(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("\"") || trimmed.endsWith("\"")) {
    if (!(trimmed.startsWith("\"") && trimmed.endsWith("\"")) || trimmed.length < 3) return undefined;
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function sanitizeExecutablePathEntries(
  entries: readonly string[],
  options: ExecutableSearchPathOptions = {}
): string[] {
  const platform = options.platform ?? process.platform;
  const pathApi = platformPath(platform);
  const excludedRoots = (options.excludedRoots ?? [process.cwd()])
    .filter((value) => typeof value === "string" && pathApi.isAbsolute(value))
    .map((value) => pathApi.normalize(value));
  const excludedPaths = (options.excludedPaths ?? [])
    .filter((value) => typeof value === "string" && pathApi.isAbsolute(value))
    .map((value) => comparisonKey(value, platform));
  const accepted: string[] = [];
  const seen = new Set<string>();

  for (const rawEntry of entries) {
    const unquoted = stripBalancedQuotes(rawEntry);
    if (!unquoted || /[\0\r\n]/.test(unquoted) || !pathApi.isAbsolute(unquoted)) continue;
    const normalized = pathApi.normalize(unquoted);
    if (isProjectScopedShim(normalized, platform)) continue;
    if (excludedPaths.includes(comparisonKey(normalized, platform))) continue;
    if (excludedRoots.some((root) => isWithin(normalized, root, platform))) continue;
    const key = comparisonKey(normalized, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(normalized);
  }
  return accepted;
}

export function getLaunchPathExclusions(
  inheritedCwd: string = process.cwd(),
  homeDirectory: string = homedir(),
  platform: NodeJS.Platform = process.platform,
  probe: LaunchPathExclusionProbe = {}
): LaunchPathExclusions {
  const pathApi = platformPath(platform);
  if (!pathApi.isAbsolute(inheritedCwd)) return { excludedRoots: [], excludedPaths: [] };
  const realpath = probe.realpath ?? defaultRealpath;
  const variants = (value: string): string[] => {
    if (!pathApi.isAbsolute(value)) return [];
    const accepted = [pathApi.normalize(value)];
    try {
      const canonical = pathApi.normalize(realpath(accepted[0]));
      if (pathApi.isAbsolute(canonical)) accepted.push(canonical);
    } catch {
      // The lexical path remains excluded when canonical resolution is unavailable.
    }
    const seen = new Set<string>();
    return accepted.filter((candidate) => {
      const key = comparisonKey(candidate, platform);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const cwdVariants = variants(inheritedCwd);
  const homeKeys = new Set(variants(homeDirectory).map((candidate) => comparisonKey(candidate, platform)));
  const isHome = cwdVariants.some((candidate) => homeKeys.has(comparisonKey(candidate, platform)));
  const isRoot = cwdVariants.some((candidate) =>
    comparisonKey(candidate, platform) === comparisonKey(pathApi.parse(candidate).root, platform)
  );
  return isHome || isRoot
    ? { excludedRoots: [], excludedPaths: cwdVariants }
    : { excludedRoots: cwdVariants, excludedPaths: [] };
}

function defaultLstat(file: string): FileIdentity {
  return lstatSync(file);
}

function defaultRealpath(file: string): string {
  return realpathSync.native(file);
}

function defaultAccess(file: string, mode: number): void {
  accessSync(file, mode);
}

function assertCanonicalDirectory(
  requested: string,
  platform: NodeJS.Platform,
  lstat: (file: string) => FileIdentity,
  realpath: (file: string) => string
): string {
  const pathApi = platformPath(platform);
  if (!pathApi.isAbsolute(requested) || /[\0\r\n]/.test(requested)) {
    throw new Error("Process working directory must be an absolute local directory.");
  }
  const normalized = pathApi.normalize(requested);
  let identity: FileIdentity;
  let canonical: string;
  let canonicalIdentity: FileIdentity;
  try {
    identity = lstat(normalized);
    canonical = pathApi.normalize(realpath(normalized));
    canonicalIdentity = lstat(canonical);
  } catch {
    throw new Error("Process working directory could not be verified.");
  }
  if (
    !identity.isDirectory()
    || identity.isSymbolicLink()
    || !canonicalIdentity.isDirectory()
    || canonicalIdentity.isSymbolicLink()
  ) {
    throw new Error("Process working directory must be a real local directory.");
  }
  return canonical;
}

function assertCanonicalExecutable(
  requested: string,
  platform: NodeJS.Platform,
  lstat: (file: string) => FileIdentity,
  realpath: (file: string) => string,
  access: (file: string, mode: number) => void,
  rejectSymbolicLink: boolean
): string {
  const pathApi = platformPath(platform);
  if (!pathApi.isAbsolute(requested) || /[\0\r\n]/.test(requested)) {
    throw new Error("Executable path must be absolute.");
  }
  const normalized = pathApi.normalize(requested);
  let identity: FileIdentity;
  let canonical: string;
  let canonicalIdentity: FileIdentity;
  try {
    identity = lstat(normalized);
    canonical = pathApi.normalize(realpath(normalized));
    canonicalIdentity = lstat(canonical);
  } catch {
    throw new Error("Executable path could not be verified.");
  }
  const requestedIdentityIsAllowed = identity.isFile()
    || (!rejectSymbolicLink && identity.isSymbolicLink());
  if (
    !requestedIdentityIsAllowed
    || (rejectSymbolicLink && identity.isSymbolicLink())
    || !canonicalIdentity.isFile()
    || canonicalIdentity.isSymbolicLink()
  ) {
    throw new Error("Executable path must be a real regular file.");
  }
  if (platform !== "win32") {
    try {
      access(normalized, fsConstants.X_OK);
    } catch {
      throw new Error("Executable path is not executable.");
    }
  }
  return canonical;
}

function windowsEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const matches = Object.entries(environment)
    .filter(([candidate, value]) => candidate.toUpperCase() === name.toUpperCase() && value !== undefined)
    .map(([, value]) => value as string);
  if (new Set(matches).size > 1) {
    throw new Error(`Windows ${name} environment is inconsistent.`);
  }
  return matches[0];
}

function resolveWindowsRoot(
  environment: NodeJS.ProcessEnv,
  probe: ExecutableResolutionProbe
): string {
  const rawRoot = probe.systemRoot ?? windowsEnvironmentValue(environment, "SystemRoot");
  const rawWindir = windowsEnvironmentValue(environment, "WINDIR");
  if (
    typeof rawRoot !== "string"
    || rawRoot.length === 0
    || rawRoot !== rawRoot.trim()
    || FORBIDDEN_PATH_CHARACTERS.test(rawRoot)
  ) {
    throw new Error("Windows system directory could not be verified.");
  }
  const normalizedRoot = path.win32.normalize(rawRoot);
  const parsedRoot = path.win32.parse(normalizedRoot).root;
  if (
    !path.win32.isAbsolute(normalizedRoot)
    || !/^[A-Za-z]:\\$/.test(parsedRoot)
    || path.win32.dirname(normalizedRoot).toLowerCase() !== parsedRoot.toLowerCase()
    || path.win32.basename(normalizedRoot).toLowerCase() !== "windows"
  ) {
    throw new Error("Windows system directory could not be verified.");
  }
  if (
    rawWindir
    && comparisonKey(path.win32.normalize(rawWindir), "win32") !== comparisonKey(normalizedRoot, "win32")
  ) {
    throw new Error("Windows system directory environment is inconsistent.");
  }

  const lstat = probe.lstat ?? defaultLstat;
  const realpath = probe.realpath ?? defaultRealpath;
  const canonicalRoot = assertCanonicalDirectory(normalizedRoot, "win32", lstat, realpath);
  if (comparisonKey(canonicalRoot, "win32") !== comparisonKey(normalizedRoot, "win32")) {
    throw new Error("Windows system directory must not traverse a redirect.");
  }
  return canonicalRoot;
}

export function resolveWindowsSystemDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  probe: ExecutableResolutionProbe = {}
): string {
  const root = resolveWindowsRoot(environment, probe);
  const lstat = probe.lstat ?? defaultLstat;
  const realpath = probe.realpath ?? defaultRealpath;
  const requested = path.win32.join(root, "System32");
  const canonical = assertCanonicalDirectory(requested, "win32", lstat, realpath);
  if (comparisonKey(canonical, "win32") !== comparisonKey(requested, "win32")) {
    throw new Error("Windows System32 directory must not traverse a redirect.");
  }
  return canonical;
}

export function resolveWindowsSystemExecutable(
  executableName: string,
  environment: NodeJS.ProcessEnv = process.env,
  probe: ExecutableResolutionProbe = {}
): string {
  const normalizedName = executableName.toLowerCase();
  const fromRoot = WINDOWS_ROOT_EXECUTABLES.has(normalizedName);
  if (!fromRoot && !WINDOWS_SYSTEM32_EXECUTABLES.has(normalizedName)) {
    throw new Error("Windows system executable is not allowlisted.");
  }
  const root = resolveWindowsRoot(environment, probe);
  const directory = fromRoot ? root : resolveWindowsSystemDirectory(environment, probe);
  const requested = path.win32.join(directory, normalizedName);
  const lstat = probe.lstat ?? defaultLstat;
  const realpath = probe.realpath ?? defaultRealpath;
  const access = probe.access ?? defaultAccess;
  const canonical = assertCanonicalExecutable(requested, "win32", lstat, realpath, access, true);
  if (comparisonKey(canonical, "win32") !== comparisonKey(requested, "win32")) {
    throw new Error("Windows system executable must not traverse a redirect.");
  }
  return canonical;
}

function executablePathValue(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return windowsEnvironmentValue(environment, "PATH") ?? "";
  }
  return environment.PATH ?? "";
}

export function resolveExecutableForSpawn(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
  probe: ExecutableResolutionProbe = {}
): string {
  const platform = probe.platform ?? process.platform;
  const pathApi = platformPath(platform);
  const lstat = probe.lstat ?? defaultLstat;
  const realpath = probe.realpath ?? defaultRealpath;
  const access = probe.access ?? defaultAccess;
  const inheritedCwd = probe.inheritedCwd ?? process.cwd();
  const { excludedRoots, excludedPaths } = getLaunchPathExclusions(
    inheritedCwd,
    probe.homeDirectory ?? homedir(),
    platform,
    { realpath: probe.realpath }
  );
  const excludedPathKeys = new Set(
    excludedPaths.map((candidate) => comparisonKey(candidate, platform))
  );
  const trustedDirectories = sanitizeExecutablePathEntries(
    probe.trustedPathDirectories ?? [],
    { platform, excludedRoots: [], excludedPaths: [] }
  );
  const isTrustedPath = (candidate: string) =>
    trustedDirectories.some((directory) => isWithin(candidate, directory, platform));
  const isExcludedPath = (candidate: string) =>
    excludedPathKeys.has(comparisonKey(candidate, platform))
    || excludedRoots.some((root) => isWithin(candidate, root, platform));
  const basename = pathApi.basename(command).toLowerCase();

  if (
    platform === "win32"
    && (WINDOWS_ROOT_EXECUTABLES.has(basename) || WINDOWS_SYSTEM32_EXECUTABLES.has(basename))
  ) {
    const trusted = resolveWindowsSystemExecutable(basename, environment, probe);
    if (path.win32.isAbsolute(command) && comparisonKey(command, "win32") !== comparisonKey(trusted, "win32")) {
      throw new Error("Windows system helpers must use their verified operating-system path.");
    }
    return trusted;
  }

  if (pathApi.isAbsolute(command)) {
    const requested = pathApi.normalize(command);
    const canonical = assertCanonicalExecutable(
      requested,
      platform,
      lstat,
      realpath,
      access,
      platform === "win32"
    );
    if (
      isProjectScopedShim(canonical, platform)
      || (isExcludedPath(canonical) && !isTrustedPath(canonical))
    ) {
      throw new Error("Executable path is inside the untrusted launch project.");
    }
    return platform === "win32" ? canonical : requested;
  }

  const safeName = platform === "win32" ? SAFE_WINDOWS_EXECUTABLE_NAME : SAFE_POSIX_EXECUTABLE_NAME;
  if (!safeName.test(command) || command !== pathApi.basename(command)) {
    throw new Error("Executable name is invalid.");
  }
  let candidateName = command;
  if (platform === "win32") {
    const extension = path.win32.extname(command).toLowerCase();
    if (extension && extension !== ".exe") throw new Error("Windows developer tools must be native executables.");
    if (!extension) candidateName = `${command}.exe`;
  }

  const directories = sanitizeExecutablePathEntries([
    ...trustedDirectories,
    ...sanitizeExecutablePathEntries(
      executablePathValue(environment, platform).split(pathApi.delimiter),
      { platform, excludedRoots, excludedPaths }
    )
  ], { platform, excludedRoots: [], excludedPaths: [] });
  for (const directory of directories) {
    const requested = pathApi.join(directory, candidateName);
    try {
      const canonical = assertCanonicalExecutable(
        requested,
        platform,
        lstat,
        realpath,
        access,
        platform === "win32"
      );
      if (
        isProjectScopedShim(canonical, platform)
        || (isExcludedPath(canonical) && !isTrustedPath(canonical))
      ) {
        continue;
      }
      return platform === "win32" ? canonical : requested;
    } catch {
      continue;
    }
  }
  throw new Error("Executable was not found on the trusted search path.");
}

export function resolveExecutionDirectory(
  requested: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  probe: ExecutableResolutionProbe = {}
): string {
  const platform = probe.platform ?? process.platform;
  if (!requested) {
    if (platform !== "win32") throw new Error("A process working directory is required.");
    return resolveWindowsSystemDirectory(environment, probe);
  }
  return assertCanonicalDirectory(
    requested,
    platform,
    probe.lstat ?? defaultLstat,
    probe.realpath ?? defaultRealpath
  );
}
