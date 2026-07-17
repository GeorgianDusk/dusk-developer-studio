export type CommandPlatform = "windows" | "posix";

export interface DuskDsCommandSet {
  platform: CommandPlatform;
  projectPath: string;
  build: string;
  test: string;
  testEnvironment: "Ubuntu-24.04 WSL" | "native Linux";
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

export function buildDuskDsCommandSet(options: {
  parentDir: string;
  projectName: string;
  platform: CommandPlatform;
}): DuskDsCommandSet {
  const projectPath = resolveDuskDsProjectPath(options.parentDir, options.projectName, options.platform);
  if (options.platform === "windows") {
    return {
      platform: "windows",
      projectPath,
      build: [
        `Set-Location -LiteralPath ${quotePowerShellArg(projectPath)}`,
        "dusk-forge check",
        "dusk-forge build all"
      ].join("\n"),
      test: `wsl -d Ubuntu-24.04 -- bash -lc ${quotePowerShellArg(
        `cd ${quotePosixArg(windowsPathToWsl(projectPath))} && dusk-forge test`
      )}`,
      testEnvironment: "Ubuntu-24.04 WSL"
    };
  }
  return {
    platform: "posix",
    projectPath,
    build: [`cd ${quotePosixArg(projectPath)}`, "dusk-forge check", "dusk-forge build all"].join("\n"),
    test: [`cd ${quotePosixArg(projectPath)}`, "dusk-forge test"].join("\n"),
    testEnvironment: "native Linux"
  };
}
