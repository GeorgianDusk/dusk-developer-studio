import { delimiter } from "node:path";

const SAFE_ENVIRONMENT_KEYS = new Set([
  "APPDATA", "CARGO_HOME", "COMSPEC", "FOUNDRY_DIR", "HOME", "HOMEDRIVE", "HOMEPATH",
  "LANG", "LC_ALL", "LC_CTYPE", "LOCALAPPDATA", "LOGNAME", "PATH", "PATHEXT", "PROGRAMDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "RUSTUP_HOME", "SHELL", "SYSTEMDRIVE", "SYSTEMROOT",
  "TEMP", "TERM", "TMP", "TMPDIR", "USER", "USERPROFILE", "WINDIR", "WSL_DISTRO_NAME",
  "WSL_INTEROP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"
]);

const SECRET_NAME_RE = /(?:^|_)(?:API_?KEY|AUTH|CREDENTIALS?|COOKIE|KEY|MNEMONIC|PASS(?:WORD|WD)?|PRIVATE|SECRET|SEED|TOKEN)(?:_|$)/i;

export interface ChildEnvironmentOptions { pathAdditions?: string[]; }

function isSafeEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return !normalized.startsWith("DUSK_STUDIO_") && !SECRET_NAME_RE.test(normalized) && SAFE_ENVIRONMENT_KEYS.has(normalized);
}

function currentPath(environment: NodeJS.ProcessEnv): string {
  for (const [name, value] of Object.entries(environment)) if (name.toUpperCase() === "PATH" && value) return value;
  return "";
}

export function createChildEnvironment(source: NodeJS.ProcessEnv = process.env, options: ChildEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && isSafeEnvironmentName(name)) environment[name] = value;
  }
  for (const name of Object.keys(environment)) if (name.toUpperCase() === "PATH") delete environment[name];
  const pathValue = [...(options.pathAdditions ?? []), currentPath(source)]
    .map((entry) => entry.trim()).filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index).join(delimiter);
  if (pathValue) environment.PATH = pathValue;
  return environment;
}
