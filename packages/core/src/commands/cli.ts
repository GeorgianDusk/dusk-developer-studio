export type CommandPlatform = "windows" | "posix";

// Forge's generated native-linker paths are substantially longer than the
// selected project path. Keep Windows roots short enough for the full build.
export const WINDOWS_DUSKDS_MANAGED_ROOT_MAX_LENGTH = 120;
export const WINDOWS_DUSKDS_PROJECT_PATH_MAX_LENGTH = 140;

export interface DuskDsDeployCommandSet {
  platform: CommandPlatform;
  prerequisiteChecks: string;
  deployTemplate: string;
}

const WINDOWS_ROOT = "C:\\tmp\\dusk-studio-projects";
const POSIX_ROOT = ".generated";

function assertSafeArgument(value: string): void {
  for (const character of value) {
    if (character.charCodeAt(0) === 0 || character === "\r" || character === "\n") {
      throw new Error("Command arguments cannot contain control characters.");
    }
  }
}
export function quotePosixArg(value: string): string {
  assertSafeArgument(value);
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function quotePowerShellArg(value: string): string {
  assertSafeArgument(value);
  return `'${value.replace(/'/g, "''")}'`;
}

export function windowsPathToWsl(value: string): string {
  assertSafeArgument(value);
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(value);
  if (!match || value.startsWith("\\\\") || value.startsWith("\\\\?\\")) {
    throw new Error("VM test guidance requires an absolute Windows drive path.");
  }
  const tail = match[2].replace(/\\/g, "/");
  return `/mnt/${match[1].toLowerCase()}/${tail}`;
}

function joinPath(parent: string, child: string, separator: "\\" | "/"): string {
  const cleaned = parent.replace(/[\\/]+$/, "");
  if (separator === "/" && parent.startsWith("/") && cleaned === "") {
    return `/${child}`;
  }
  if (separator === "\\" && /^[a-zA-Z]:[\\/]+$/.test(parent)) {
    return `${parent.slice(0, 2)}\\${child}`;
  }
  return `${cleaned}${separator}${child}`;
}

export function resolveDuskDsProjectPath(parentDir: string, projectName: string, platform: CommandPlatform): string {
  assertSafeArgument(parentDir);
  assertSafeArgument(projectName);
  const root = platform === "windows" ? WINDOWS_ROOT : POSIX_ROOT;
  const separator = platform === "windows" ? "\\" : "/";
  const absoluteParent = platform === "windows" ? /^[a-zA-Z]:[\\/]/.test(parentDir) : parentDir.startsWith("/");
  const base = parentDir.trim() ? (absoluteParent ? parentDir : joinPath(root, parentDir, separator)) : root;
  return joinPath(base, projectName, separator);
}

export function resolveDuskDsProjectParent(projectPath: string, projectName: string, platform: CommandPlatform): string {
  assertSafeArgument(projectPath);
  assertSafeArgument(projectName);
  const separator = platform === "windows" ? "\\" : "/";
  const suffix = `${separator}${projectName}`;
  if (!projectName || !projectPath.endsWith(suffix)) {
    throw new Error("Project path does not end with the expected project folder.");
  }
  const parent = projectPath.slice(0, -suffix.length);
  if (platform === "posix" && parent === "") return "/";
  if (platform === "windows" && /^[a-zA-Z]:$/.test(parent)) return `${parent}\\`;
  if (!parent) throw new Error("Project path has no usable parent folder.");
  return parent;
}

/**
 * Returns a deliberately incomplete manual deployment shape. Placeholder
 * values keep the command from being a one-click deployment, while quoting
 * them prevents shell redirection if somebody runs the template unchanged.
 * Studio must never fill wallet, funding, nonce, fee, or signing values.
 */
export function buildDuskDsDeployCommandSet(platform: CommandPlatform): DuskDsDeployCommandSet {
  const newline = platform === "windows" ? "\r\n" : "\n";
  const continuation = platform === "windows" ? " `" : " \\";
  return {
    platform,
    prerequisiteChecks: [
      "rusk-wallet --version",
      "rusk-wallet --network testnet settings",
      "rusk-wallet --network testnet contract-deploy --help"
    ].join(newline),
    deployTemplate: [
      `rusk-wallet --network testnet contract-deploy${continuation}`,
      `  --address "<PUBLIC_TESTNET_ADDRESS>"${continuation}`,
      `  --code "<PATH_TO_WASM_CONTRACT>"${continuation}`,
      '  --deploy-nonce "<UNUSED_NONCE>"'
    ].join(newline)
  };
}
