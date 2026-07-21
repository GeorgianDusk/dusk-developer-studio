import toolchainPolicy from "../../../../config/duskds-toolchain-policy.json";
import npmPackage from "../../../../packages/cli/package.json";

export type ManualPlatform = "windows" | "linux" | "macos";
export type ManualToolScope = "setup" | "access" | "build" | "inspect";

export const DUSKDS_RUST_TOOLCHAIN = toolchainPolicy.rust_toolchain;
export const DUSKDS_FORGE_COMMIT = toolchainPolicy.dusk_forge.revision;
export const DUSKDS_FORGE_PACKAGE_VERSION = toolchainPolicy.dusk_forge.package_version;
export const DUSKDS_TEMPLATE_ID = toolchainPolicy.dusk_forge.reviewed_template.id;
export const DUSKDS_TEMPLATE_LOCK_SHA256 = toolchainPolicy.dusk_forge.reviewed_template.template_lock_sha256;
export const DUSK_STUDIO_NPM_PACKAGE_VERSION = npmPackage.version;
export const DUSK_STUDIO_NODE_ENGINE = npmPackage.engines.node;
export const W3SPER_VERSION = toolchainPolicy.w3sper.version;
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
  linux: command,
  macos: command
});

const POSIX_PIN_TOOLCHAIN_COMMAND = `sed -i.bak 's/channel[[:space:]]*=[[:space:]]*"[^"]*"/channel = "${DUSKDS_RUST_TOOLCHAIN}"/' rust-toolchain.toml && rm -f rust-toolchain.toml.bak`;

export function reviewedDuskForgeGuardCommands(platform: ManualPlatform): string[] {
  if (platform === "windows") {
    return [
      "$forgeRootCandidate = if ($env:CARGO_INSTALL_ROOT) { $env:CARGO_INSTALL_ROOT } elseif ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME '.cargo' }",
      "$forgeRoot = [System.IO.Path]::GetFullPath($forgeRootCandidate)",
      "$forgeReceipt = Join-Path $forgeRoot '.crates2.json'",
      "$forgeBin = Join-Path $forgeRoot 'bin'",
      "$forgeExe = Join-Path $forgeBin 'dusk-forge.exe'",
      "if (-not (Test-Path -LiteralPath $forgeReceipt -PathType Leaf)) { throw 'Dusk Forge Cargo receipt is missing.' }",
      `$forgeMatches = @(Select-String -LiteralPath $forgeReceipt -Pattern 'dusk-forge-cli\\s+v?${DUSKDS_FORGE_PACKAGE_VERSION.replaceAll(".", "\\.")}.*${DUSKDS_FORGE_COMMIT}' -ErrorAction Stop)`,
      "if ($forgeMatches.Count -eq 0) { throw 'Reviewed Dusk Forge commit is not installed in this Cargo root.' }",
      "if (-not (Test-Path -LiteralPath $forgeExe -PathType Leaf)) { throw 'Reviewed Dusk Forge executable is missing from this Cargo root.' }",
      "$env:PATH = \"$forgeBin;$env:PATH\"",
      "& $forgeExe --version",
      "if ($LASTEXITCODE -ne 0) { throw 'Reviewed Dusk Forge executable check failed.' }"
    ];
  }
  return [
    'forgeRoot="${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}"',
    'forgeReceipt="$forgeRoot/.crates2.json"',
    'forgeBin="$forgeRoot/bin"',
    'forgeExe="$forgeBin/dusk-forge"',
    'test -f "$forgeReceipt"',
    `grep -Eq "dusk-forge-cli[[:space:]]+v?${DUSKDS_FORGE_PACKAGE_VERSION.replaceAll(".", "\\.")}.*${DUSKDS_FORGE_COMMIT}" "$forgeReceipt"`,
    'test -x "$forgeExe"',
    'PATH="$forgeBin:$PATH"',
    "export PATH",
    '"$forgeExe" --version'
  ];
}

export function reviewedDuskForgeInvocation(platform: ManualPlatform, args: string): string {
  return platform === "windows" ? `& $forgeExe ${args}` : `"$forgeExe" ${args}`;
}

export const DUSKDS_PIN_TOOLCHAIN_COMMAND: Record<ManualPlatform, string> = {
  windows: [
    "$toolchainPath = (Resolve-Path -LiteralPath '.\\rust-toolchain.toml' -ErrorAction Stop).Path",
    "$toolchainText = Get-Content -Raw -LiteralPath $toolchainPath -ErrorAction Stop",
    "if ($toolchainText -notmatch 'channel\\s*=\\s*\"[^\"]+\"') { throw 'rust-toolchain.toml has no channel to pin.' }",
    `$toolchainText = $toolchainText -replace 'channel\\s*=\\s*"[^"]+"', 'channel = "${DUSKDS_RUST_TOOLCHAIN}"'`,
    "$utf8NoBom = [System.Text.UTF8Encoding]::new($false)",
    "[System.IO.File]::WriteAllText($toolchainPath, $toolchainText, $utf8NoBom)",
    "$verifiedToolchainText = Get-Content -Raw -LiteralPath $toolchainPath -ErrorAction Stop",
    `if ($verifiedToolchainText -notmatch 'channel\\s*=\\s*"${DUSKDS_RUST_TOOLCHAIN.replaceAll(".", "\\.")}"') { throw 'Rust toolchain pin verification failed.' }`
  ].join("; "),
  linux: POSIX_PIN_TOOLCHAIN_COMMAND,
  macos: POSIX_PIN_TOOLCHAIN_COMMAND
};

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
      linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
      macos: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
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
    checkCommand: {
      windows: `rustup run ${DUSKDS_RUST_TOOLCHAIN} rustc --version; if ($LASTEXITCODE -ne 0) { throw 'Rust ${DUSKDS_RUST_TOOLCHAIN} rustc check failed.' }; rustup run ${DUSKDS_RUST_TOOLCHAIN} cargo --version; if ($LASTEXITCODE -ne 0) { throw 'Rust ${DUSKDS_RUST_TOOLCHAIN} Cargo check failed.' }`,
      linux: `rustup run ${DUSKDS_RUST_TOOLCHAIN} rustc --version && rustup run ${DUSKDS_RUST_TOOLCHAIN} cargo --version`,
      macos: `rustup run ${DUSKDS_RUST_TOOLCHAIN} rustc --version && rustup run ${DUSKDS_RUST_TOOLCHAIN} cargo --version`
    },
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
    reviewedIdentity: `dusk-forge-cli ${DUSKDS_FORGE_PACKAGE_VERSION} from Git commit ${DUSKDS_FORGE_COMMIT}`,
    purpose: "Creates, checks, builds, and VM-tests the native starter from the exact reviewed Forge source commit.",
    checkCommand: {
      windows: reviewedDuskForgeGuardCommands("windows").join("; "),
      linux: `( set -e; ${reviewedDuskForgeGuardCommands("linux").join("; ")} )`,
      macos: `( set -e; ${reviewedDuskForgeGuardCommands("macos").join("; ")} )`
    },
    installCommand: same(`cargo +${DUSKDS_RUST_TOOLCHAIN} install --force --git https://github.com/dusk-network/forge --rev ${DUSKDS_FORGE_COMMIT} dusk-forge-cli`),
    helpUrl: "https://github.com/dusk-network/forge",
    expectedResult: `The version command succeeds and Cargo's install receipt contains dusk-forge-cli ${DUSKDS_FORGE_PACKAGE_VERSION} at exact commit ${DUSKDS_FORGE_COMMIT}. The receipt does not attest executable bytes or the transitive dependency graph.`
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
      linux: "curl -fsSL https://deno.land/install.sh | sh",
      macos: "curl -fsSL https://deno.land/install.sh | sh"
    },
    helpUrl: "https://docs.deno.com/runtime/getting_started/installation/",
    expectedResult: "A Deno version is printed."
  },
  {
    id: "wsl",
    name: "WSL with Ubuntu 24.04",
    scopes: ["setup", "build"],
    requirement: "conditional",
    reviewedIdentity: "Windows VM-test lane",
    purpose: "Runs the currently reviewed Linux-backed Dusk Forge VM test on Windows.",
    checkCommand: {
      windows: `wsl -d Ubuntu-24.04 -- bash -lc 'set -e; command -v make >/dev/null; command -v jq >/dev/null; command -v wasm-opt >/dev/null; rustup run ${DUSKDS_RUST_TOOLCHAIN} rustc --version; rustup target list --installed --toolchain ${DUSKDS_RUST_TOOLCHAIN} | grep -q wasm32-unknown-unknown; rustup component list --installed --toolchain ${DUSKDS_RUST_TOOLCHAIN} | grep -q rust-src; ${reviewedDuskForgeGuardCommands("linux").join("; ")}'`,
      linux: "uname -s | grep -qx Linux",
      macos: "uname -s"
    },
    installCommand: {
      windows: [
        "wsl -d Ubuntu-24.04 -- true",
        "if ($LASTEXITCODE -ne 0) { wsl --install -d Ubuntu-24.04; if ($LASTEXITCODE -ne 0) { throw 'Ubuntu 24.04 WSL installation failed or requires a reboot.' } }",
        `wsl -d Ubuntu-24.04 -- bash -lc 'set -e; sudo apt-get update; sudo apt-get install -y build-essential jq binaryen curl git; if ! command -v rustup >/dev/null; then curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; fi; . "$HOME/.cargo/env"; rustup toolchain install ${DUSKDS_RUST_TOOLCHAIN} --component rust-src --target wasm32-unknown-unknown; cargo +${DUSKDS_RUST_TOOLCHAIN} install --force --git https://github.com/dusk-network/forge --rev ${DUSKDS_FORGE_COMMIT} dusk-forge-cli'`,
        "if ($LASTEXITCODE -ne 0) { throw 'Reviewed Ubuntu DuskDS tool installation failed.' }"
      ].join("; "),
      linux: "Use the native Linux Setup checks; WSL is not used.",
      macos: "WSL is Windows-only."
    },
    helpUrl: "https://learn.microsoft.com/windows/wsl/install",
    expectedResult: "Windows: Ubuntu 24.04 reports the Dusk Forge executable from the exact Cargo root and Rust 1.94.0. Linux: use the native test lane. macOS needs a Linux VM or container for the reviewed VM test."
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
    checkCommand: {
      windows: "$wasmOpt = Get-Command wasm-opt -ErrorAction Stop; if ($wasmOpt.CommandType -ne 'Application' -or $wasmOpt.Source -notmatch '\\.exe$') { throw 'wasm-opt must resolve to a native .exe, not an extensionless npm shim.' }; & $wasmOpt.Source --version",
      linux: "wasm-opt --version",
      macos: "wasm-opt --version"
    },
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

export function requiredManualCheckBundle(scope: ManualToolScope, platform: ManualPlatform): string {
  const tools = manualToolsFor(scope).filter((tool) => tool.requirement === "required");
  if (platform === "windows") {
    return tools.map((tool) => {
      const label = tool.name.replaceAll("'", "''");
      return [
        `Write-Host '=== ${label} ==='`,
        tool.checkCommand.windows,
        `if ($LASTEXITCODE -ne 0) { throw '${label} check failed.' }`
      ].join("; ");
    }).join(";\n");
  }

  const commands = tools.flatMap((tool) => {
    const label = tool.name.replaceAll("'", "'\"'\"'");
    return [
      `printf '\\n=== %s ===\\n' '${label}'`,
      tool.checkCommand[platform]
    ];
  });
  return ["(", "set -e", ...commands, ")"].join("\n");
}

const W3SPER_POSIX_WORKSPACE = "duskds-w3sper-check";
const W3SPER_WINDOWS_ENTER = "Set-Location -LiteralPath 'duskds-w3sper-check' -ErrorAction Stop";
const W3SPER_POSIX_ENTER = `cd '${W3SPER_POSIX_WORKSPACE}'`;
export const W3SPER_INSTALL_COMMAND: Record<ManualPlatform, string> = {
  windows: `${W3SPER_WINDOWS_ENTER}; deno add --save-exact jsr:@dusk/w3sper@${W3SPER_VERSION}; if ($LASTEXITCODE -ne 0) { throw 'W3sper installation failed.' }`,
  linux: `( set -e; ${W3SPER_POSIX_ENTER}; deno add --save-exact jsr:@dusk/w3sper@${W3SPER_VERSION} )`,
  macos: `( set -e; ${W3SPER_POSIX_ENTER}; deno add --save-exact jsr:@dusk/w3sper@${W3SPER_VERSION} )`
};
export const W3SPER_RUN_COMMAND: Record<ManualPlatform, string> = {
  windows: `${W3SPER_WINDOWS_ENTER}; deno run --frozen --allow-net=testnet.nodes.dusk.network check-duskds.ts; if ($LASTEXITCODE -ne 0) { throw 'W3sper node read failed.' }`,
  linux: `( set -e; ${W3SPER_POSIX_ENTER}; deno run --frozen --allow-net=testnet.nodes.dusk.network check-duskds.ts )`,
  macos: `( set -e; ${W3SPER_POSIX_ENTER}; deno run --frozen --allow-net=testnet.nodes.dusk.network check-duskds.ts )`
};
export const W3SPER_WORKSPACE_COMMAND: Record<ManualPlatform, string> = {
  windows: "if (Test-Path -LiteralPath 'duskds-w3sper-check') { throw 'Dedicated W3sper folder already exists.' }; New-Item -ItemType Directory 'duskds-w3sper-check' -ErrorAction Stop | Out-Null",
  linux: `( set -e; if [ -e '${W3SPER_POSIX_WORKSPACE}' ]; then echo 'Dedicated W3sper folder already exists.' >&2; exit 1; fi; mkdir '${W3SPER_POSIX_WORKSPACE}' )`,
  macos: `( set -e; if [ -e '${W3SPER_POSIX_WORKSPACE}' ]; then echo 'Dedicated W3sper folder already exists.' >&2; exit 1; fi; mkdir '${W3SPER_POSIX_WORKSPACE}' )`
};
export const W3SPER_CREATE_FILE_COMMAND: Record<ManualPlatform, string> = {
  windows: `${W3SPER_WINDOWS_ENTER}; if (Test-Path -LiteralPath 'check-duskds.ts') { throw 'check-duskds.ts already exists.' }; New-Item -ItemType File 'check-duskds.ts' -ErrorAction Stop | Out-Null`,
  linux: `( set -e; ${W3SPER_POSIX_ENTER}; if [ -e 'check-duskds.ts' ]; then echo 'check-duskds.ts already exists.' >&2; exit 1; fi; : > 'check-duskds.ts' )`,
  macos: `( set -e; ${W3SPER_POSIX_ENTER}; if [ -e 'check-duskds.ts' ]; then echo 'check-duskds.ts already exists.' >&2; exit 1; fi; : > 'check-duskds.ts' )`
};
export const W3SPER_NODE_READ_SNIPPET = [
  'import { Network } from "@dusk/w3sper";',
  "",
  `const network = await Network.connect("${DUSKDS_TESTNET_NODE}");`,
  "try {",
  '  const tip = await network.query("block(height: -1) { header { height hash } }");',
  "  console.log(JSON.stringify(tip.block.header));",
  "} finally {",
  "  await network.disconnect();",
  "}"
].join("\n");
