import toolchainPolicy from "../../../../config/duskds-toolchain-policy.json";

export type ManualPlatform = "windows" | "posix";
export type ManualToolScope = "setup" | "access" | "build" | "inspect";

export const DUSKDS_RUST_TOOLCHAIN = toolchainPolicy.rust_toolchain;
export const DUSKDS_FORGE_COMMIT = toolchainPolicy.dusk_forge.revision;
export const DUSKDS_TESTNET_NODE = "https://testnet.nodes.dusk.network";

export interface ManualToolRequirement {
  id: string;
  name: string;
  scopes: ManualToolScope[];
  requirement: "required" | "conditional" | "optional";
  reviewedIdentity: string;
  purpose: string;
  checkCommand: Record<ManualPlatform, string>;
  installCommand?: Record<ManualPlatform, string>;
  helpUrl: string;
  expectedResult: string;
}

const same = (command: string): Record<ManualPlatform, string> => ({
  windows: command,
  posix: command
});

export const DUSKDS_MANUAL_TOOLS: ManualToolRequirement[] = [
  {
    id: "git",
    name: "Git",
    scopes: ["setup", "build"],
    requirement: "required",
    reviewedIdentity: "Any maintained Git release",
    purpose: "Retrieves the reviewed Forge source and records your project revision.",
    checkCommand: same("git --version"),
    helpUrl: "https://git-scm.com/downloads",
    expectedResult: "A Git version is printed."
  },
  {
    id: "rustup",
    name: "rustup",
    scopes: ["setup", "build"],
    requirement: "required",
    reviewedIdentity: "Maintained rustup release",
    purpose: `Installs and selects the Studio-reviewed Rust ${DUSKDS_RUST_TOOLCHAIN} toolchain.`,
    checkCommand: same("rustup --version"),
    installCommand: {
      windows: "winget install Rustlang.Rustup",
      posix: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    },
    helpUrl: "https://rustup.rs/",
    expectedResult: "A rustup version is printed."
  },
  {
    id: "rust-toolchain",
    name: `Rust ${DUSKDS_RUST_TOOLCHAIN} and Cargo`,
    scopes: ["setup", "build"],
    requirement: "required",
    reviewedIdentity: `Exact Studio-reviewed toolchain ${DUSKDS_RUST_TOOLCHAIN}`,
    purpose: "Builds the native contract and data-driver WASM using the same toolchain as the Studio smoke path.",
    checkCommand: same(`rustup run ${DUSKDS_RUST_TOOLCHAIN} rustc --version && rustup run ${DUSKDS_RUST_TOOLCHAIN} cargo --version`),
    installCommand: same(`rustup toolchain install ${DUSKDS_RUST_TOOLCHAIN} --component rust-src --target wasm32-unknown-unknown`),
    helpUrl: "https://rust-lang.github.io/rustup/",
    expectedResult: `Both commands report ${DUSKDS_RUST_TOOLCHAIN}.`
  },
  {
    id: "wasm-target",
    name: "Rust WASM target",
    scopes: ["setup", "build"],
    requirement: "required",
    reviewedIdentity: `wasm32-unknown-unknown for Rust ${DUSKDS_RUST_TOOLCHAIN}`,
    purpose: "Compiles the contract and data driver to WebAssembly.",
    checkCommand: same(`rustup target list --installed --toolchain ${DUSKDS_RUST_TOOLCHAIN}`),
    installCommand: same(`rustup target add wasm32-unknown-unknown --toolchain ${DUSKDS_RUST_TOOLCHAIN}`),
    helpUrl: "https://rust-lang.github.io/rustup/cross-compilation.html",
    expectedResult: "`wasm32-unknown-unknown` appears in the installed-target list."
  },
  {
    id: "rust-src",
    name: "Rust source component",
    scopes: ["setup", "build"],
    requirement: "required",
    reviewedIdentity: `rust-src for Rust ${DUSKDS_RUST_TOOLCHAIN}`,
    purpose: "Supplies the standard-library source needed by the reviewed native build.",
    checkCommand: same(`rustup component list --installed --toolchain ${DUSKDS_RUST_TOOLCHAIN}`),
    installCommand: same(`rustup component add rust-src --toolchain ${DUSKDS_RUST_TOOLCHAIN}`),
    helpUrl: "https://rust-lang.github.io/rustup/concepts/components.html",
    expectedResult: "`rust-src` appears in the installed-component list."
  },
  {
    id: "dusk-forge",
    name: "Dusk Forge CLI",
    scopes: ["setup", "build", "inspect"],
    requirement: "required",
    reviewedIdentity: `Git commit ${DUSKDS_FORGE_COMMIT}`,
    purpose: "Creates, checks, builds, and VM-tests the native starter with a reproducible source identity.",
    checkCommand: {
      windows: `dusk-forge --version; Select-String -LiteralPath "$HOME\\.cargo\\.crates2.json" -Pattern "dusk-forge-cli.*${DUSKDS_FORGE_COMMIT}"`,
      posix: `dusk-forge --version && grep -E 'dusk-forge-cli.*${DUSKDS_FORGE_COMMIT}' "\${CARGO_INSTALL_ROOT:-\${CARGO_HOME:-$HOME/.cargo}}/.crates2.json"`
    },
    installCommand: same(`cargo +${DUSKDS_RUST_TOOLCHAIN} install --locked --force --git https://github.com/dusk-network/forge --rev ${DUSKDS_FORGE_COMMIT} dusk-forge-cli`),
    helpUrl: "https://github.com/dusk-network/forge",
    expectedResult: `The version command succeeds and Cargo's install receipt contains dusk-forge-cli at exact commit ${DUSKDS_FORGE_COMMIT}.`
  },
  {
    id: "deno",
    name: "Deno",
    scopes: ["access"],
    requirement: "required",
    reviewedIdentity: "Maintained Deno release",
    purpose: "Runs the official W3sper quick-start lane without inventing an unspecified application setup.",
    checkCommand: same("deno --version"),
    installCommand: {
      windows: "winget install DenoLand.Deno",
      posix: "curl -fsSL https://deno.land/install.sh | sh"
    },
    helpUrl: "https://docs.deno.com/runtime/getting_started/installation/",
    expectedResult: "A Deno version is printed."
  },
  {
    id: "wsl",
    name: "WSL with Ubuntu 24.04",
    scopes: ["build"],
    requirement: "conditional",
    reviewedIdentity: "Windows VM-test lane",
    purpose: "Runs the currently reviewed Linux-backed Dusk Forge VM test on Windows.",
    checkCommand: {
      windows: "wsl -d Ubuntu-24.04 -- bash -lc \"dusk-forge --version && rustup run 1.94.0 rustc --version\"",
      posix: "uname -s"
    },
    helpUrl: "https://learn.microsoft.com/windows/wsl/install",
    expectedResult: "Windows: Ubuntu 24.04 reports Dusk Forge and Rust 1.94.0. Linux: use the native test lane. macOS needs a Linux VM or container for the reviewed VM test."
  },
  {
    id: "make",
    name: "Make",
    scopes: ["build"],
    requirement: "optional",
    reviewedIdentity: "Template convenience only",
    purpose: "Runs template shortcuts; direct Dusk Forge commands remain available without it.",
    checkCommand: same("make --version"),
    helpUrl: "https://www.gnu.org/software/make/",
    expectedResult: "A Make version is printed, or continue with direct Forge commands."
  },
  {
    id: "wasm-opt",
    name: "wasm-opt",
    scopes: ["build"],
    requirement: "optional",
    reviewedIdentity: "Native Binaryen executable preferred on Windows",
    purpose: "Optimizes WASM size after the required build succeeds.",
    checkCommand: same("wasm-opt --version"),
    helpUrl: "https://github.com/WebAssembly/binaryen",
    expectedResult: "A native wasm-opt version is printed; an extensionless Windows shim is not accepted."
  },
  {
    id: "jq",
    name: "jq",
    scopes: ["build", "inspect"],
    requirement: "optional",
    reviewedIdentity: "Command-line JSON helper",
    purpose: "Makes metadata and API output easier to inspect.",
    checkCommand: same("jq --version"),
    helpUrl: "https://jqlang.org/download/",
    expectedResult: "A jq version is printed."
  },
  {
    id: "rusk-wallet",
    name: "Rusk Wallet CLI",
    scopes: ["inspect"],
    requirement: "conditional",
    reviewedIdentity: "Rusk Wallet 0.3.0+ for manual DuskDS Testnet deployment",
    purpose: "Handles wallet settings, deployment, and signing in your own terminal. Studio never reads the wallet or runs the deploy command.",
    checkCommand: same(["rusk-wallet --version", "rusk-wallet --network testnet settings", "rusk-wallet --network testnet contract-deploy --help"].join("\n")),
    helpUrl: "https://docs.dusk.network/learn/rusk-wallet/",
    expectedResult: "Version 0.3.0 or newer and the intended Testnet settings are shown. Do not paste settings output or wallet secrets into Studio."
  }
];

export function manualToolsFor(scope: ManualToolScope): ManualToolRequirement[] {
  return DUSKDS_MANUAL_TOOLS.filter((tool) => tool.scopes.includes(scope));
}

export function buildManualForgeCommands(options: {
  projectMode: "new" | "existing";
  projectName: string;
  projectLabel: string;
  platform: ManualPlatform;
}): { prepare: string; build: string; test: string; revision: string } {
  const safeName = options.projectName.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "duskds-forge-starter";
  const target = options.projectMode === "new" ? safeName : options.projectLabel.trim() || "<existing-project>";
  const enter = options.platform === "windows" ? `Set-Location "${target}"` : `cd "${target}"`;
  const prepare = options.projectMode === "new"
    ? [
        `dusk-forge new ${safeName} --no-git --template counter`,
        enter,
        `rustup override set ${DUSKDS_RUST_TOOLCHAIN}`
      ].join(options.platform === "windows" ? "\r\n" : "\n")
    : [enter, `rustup override set ${DUSKDS_RUST_TOOLCHAIN}`, "dusk-forge check"].join(options.platform === "windows" ? "\r\n" : "\n");
  const build = [enter, "dusk-forge check", "dusk-forge build all"].join(options.platform === "windows" ? "\r\n" : "\n");
  const testCommand = options.platform === "windows"
    ? `wsl -d Ubuntu-24.04 -- bash -lc 'cd "${target}" && dusk-forge test'`
    : [enter, "dusk-forge test"].join("\n");
  const revision = options.projectMode === "new" ? "git init && git add . && git commit -m \"Create reviewed DuskDS starter\" && git rev-parse HEAD" : "git rev-parse HEAD";
  return { prepare, build, test: testCommand, revision };
}

export const W3SPER_INSTALL_COMMAND = "deno add jsr:@dusk/w3sper";
export const W3SPER_RUN_COMMAND = "deno run --allow-net=testnet.nodes.dusk.network check-duskds.ts";
export const W3SPER_NODE_READ_SNIPPET = [
  'import { Network } from "@dusk/w3sper";',
  "",
  `const network = await Network.connect("${DUSKDS_TESTNET_NODE}");`,
  'const tip = await network.query("block(height: -1) { header { height hash } }");',
  "console.log(JSON.stringify(tip.block.header));"
].join("\n");
