import { delimiter } from "node:path";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import {
  getLaunchPathExclusions,
  sanitizeExecutablePathEntries
} from "./executableResolution";

const SAFE_ENVIRONMENT_KEYS = new Set([
  "APPDATA", "CARGO_HOME", "COMSPEC", "FOUNDRY_DIR", "HOME", "HOMEDRIVE", "HOMEPATH",
  "LANG", "LC_ALL", "LC_CTYPE", "LOCALAPPDATA", "LOGNAME", "PATH", "PATHEXT", "PROGRAMDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "RUSTUP_HOME", "SHELL", "SYSTEMDRIVE", "SYSTEMROOT",
  "TEMP", "TERM", "TMP", "TMPDIR", "USER", "USERPROFILE", "WINDIR", "WSL_DISTRO_NAME",
  "WSL_INTEROP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"
]);

const SECRET_NAME_RE = /(?:^|_)(?:API_?KEY|AUTH|CREDENTIALS?|COOKIE|KEY|MNEMONIC|PASS(?:WORD|WD)?|PRIVATE|SECRET|SEED|TOKEN)(?:_|$)/i;

export interface ChildEnvironmentOptions {
  trustedPathAdditions?: string[];
  inheritedCwd?: string;
  homeDirectory?: string;
  realpath?(file: string): string;
  excludedPathRoots?: string[];
  excludedPaths?: string[];
}

function isSafeEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return !normalized.startsWith("DUSK_STUDIO_") && !SECRET_NAME_RE.test(normalized) && SAFE_ENVIRONMENT_KEYS.has(normalized);
}

function currentPath(environment: NodeJS.ProcessEnv): string {
  const values = Object.entries(environment)
    .filter(([name, value]) => name.toUpperCase() === "PATH" && Boolean(value))
    .map(([, value]) => value as string);
  return new Set(values).size <= 1 ? values[0] ?? "" : "";
}

export function createChildEnvironment(source: NodeJS.ProcessEnv = process.env, options: ChildEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && isSafeEnvironmentName(name)) environment[name] = value;
  }
  for (const name of Object.keys(environment)) if (name.toUpperCase() === "PATH") delete environment[name];
  const launchExclusions = options.excludedPathRoots || options.excludedPaths
    ? {
        excludedRoots: options.excludedPathRoots ?? [],
        excludedPaths: options.excludedPaths ?? []
      }
    : getLaunchPathExclusions(
        options.inheritedCwd ?? process.cwd(),
        options.homeDirectory ?? homedir(),
        process.platform,
        { realpath: options.realpath }
      );
  const trustedPathAdditions = sanitizeExecutablePathEntries(
    options.trustedPathAdditions ?? [],
    { excludedRoots: [], excludedPaths: [] }
  );
  const inheritedPath = sanitizeExecutablePathEntries(
    currentPath(source).split(delimiter),
    { ...launchExclusions, realpath: options.realpath ?? realpathSync.native }
  );
  const pathValue = sanitizeExecutablePathEntries(
    [...trustedPathAdditions, ...inheritedPath],
    { excludedRoots: [], excludedPaths: [] }
  ).join(delimiter);
  if (pathValue) environment.PATH = pathValue;
  return environment;
}
