const CLI_VERSION = "1.0.5";
const REQUIRED_NODE = ">=24.18.0 <25";
const NODE_RECOVERY = "Install Node.js 24.18.0 from https://nodejs.org/en/download/archive/v24.18.0, open a new terminal, confirm `node --version`, then rerun your Dusk Developer Studio command.";
const INFORMATIONAL_FLAGS = new Map([
  ["--help", "help"],
  ["-h", "help"],
  ["--version", "version"],
  ["-v", "version"]
]);

function assertSupportedNode() {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.versions.node);
  if (!match) throw new Error(`Dusk Developer Studio requires Node.js ${REQUIRED_NODE}.\n${NODE_RECOVERY}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== 24 || minor < 18) {
    throw new Error(`Dusk Developer Studio requires Node.js ${REQUIRED_NODE}.\n${NODE_RECOVERY}`);
  }
}

function helpText() {
  return [
    `Dusk Developer Studio ${CLI_VERSION}`,
    "",
    "Usage:",
    "  npx dusk-developer-studio [local-actions] [--no-open]",
    "  npx dusk-developer-studio create-duskds <project-name>",
    "",
    "Runs Safe mode by default. Add local-actions to enable reviewed DuskDS machine actions.",
    "create-duskds writes the packaged reviewed starter as one new child of the current directory.",
    "",
    "Options:",
    "  --no-open        Choose the browser profile yourself; open the printed URL within five minutes",
    "  -h, --help       Show command help",
    "  -v, --version    Show the installed version"
  ].join("\n");
}

export function resolveCliInvocation(args) {
  const informational = args.filter((argument) => INFORMATIONAL_FLAGS.has(argument));
  if (informational.length) {
    if (args.length !== 1) {
      throw new Error("Help and version flags cannot be combined with other arguments.");
    }
    return { kind: INFORMATIONAL_FLAGS.get(informational[0]) };
  }
  if (args[0] === "create-duskds") {
    if (args.length !== 2 || !args[1] || args[1].startsWith("-")) {
      throw new Error("Usage: dusk-developer-studio create-duskds <project-name>");
    }
    return { kind: "create-duskds", projectName: args[1] };
  }
  const capabilitiesEnabled = args[0] === "local-actions";
  return {
    kind: "run",
    capabilitiesEnabled,
    runtimeArgs: capabilitiesEnabled ? args.slice(1) : [...args]
  };
}

export async function runCli(args) {
  const invocation = resolveCliInvocation(args);
  if (invocation.kind === "help") {
    console.log(helpText());
    return;
  }
  if (invocation.kind === "version") {
    console.log(CLI_VERSION);
    return;
  }
  assertSupportedNode();
  if (invocation.kind === "create-duskds") {
    const { runDuskDsTemplateCli } = await import("../app/runtime.mjs");
    await runDuskDsTemplateCli({ projectName: invocation.projectName });
    return;
  }
  if (invocation.runtimeArgs.includes("--enable-local-actions")) {
    throw new Error(
      invocation.capabilitiesEnabled
        ? "Local Actions mode is fixed by this command; do not add --enable-local-actions."
        : "Use `dusk-developer-studio local-actions` for machine actions."
    );
  }
  if (invocation.runtimeArgs.includes("local-actions")) {
    throw new Error("The local-actions mode selector must be the first argument to dusk-developer-studio.");
  }
  const { runLocalRuntimeCli } = await import("../app/runtime.mjs");
  await runLocalRuntimeCli({
    capabilitiesEnabled: invocation.capabilitiesEnabled,
    args: invocation.runtimeArgs
  });
}

export function reportLaunchError(error) {
  console.error(error instanceof Error ? error.message : "Dusk Developer Studio could not start.");
  process.exitCode = 1;
}
