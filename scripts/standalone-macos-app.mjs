import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";

const APP_DEFINITIONS = {
  safe: {
    mode: "safe",
    appName: "Dusk Developer Studio.app",
    displayName: "Dusk Developer Studio",
    bundleId: "io.github.georgiandusk.dusk-developer-studio",
    executableName: "dusk-studio"
  },
  local_actions: {
    mode: "local-actions",
    appName: "Dusk Developer Studio Local Actions.app",
    displayName: "Dusk Developer Studio Local Actions",
    bundleId: "io.github.georgiandusk.dusk-developer-studio.local-actions",
    executableName: "dusk-studio-local-actions"
  }
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const digestFile = (file) => digest(fs.readFileSync(file));
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function regularFile(file, label) {
  if (typeof file !== "string" || !file.trim()) throw new Error(`${label} is required.`);
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}

function createAppBundle({ source, output, definition, version }) {
  const app = path.join(output, definition.appName);
  const macos = path.join(app, "Contents", "MacOS");
  fs.mkdirSync(macos, { recursive: true, mode: 0o755 });
  const bundledExecutable = path.join(macos, definition.executableName);
  fs.copyFileSync(source, bundledExecutable, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(bundledExecutable, 0o755);
  const plist = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"https://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\"><dict>",
    "<key>CFBundleDevelopmentRegion</key><string>en</string>",
    `<key>CFBundleDisplayName</key><string>${definition.displayName}</string>`,
    `<key>CFBundleExecutable</key><string>${definition.executableName}</string>`,
    `<key>CFBundleIdentifier</key><string>${definition.bundleId}</string>`,
    "<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>",
    `<key>CFBundleName</key><string>${definition.displayName}</string>`,
    "<key>CFBundlePackageType</key><string>APPL</string>",
    `<key>CFBundleShortVersionString</key><string>${version}</string>`,
    `<key>CFBundleVersion</key><string>${version}</string>`,
    "<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>",
    "<key>NSHighResolutionCapable</key><true/>",
    "</dict></plist>",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(app, "Contents", "Info.plist"), plist, { flag: "wx", mode: 0o644 });
  return { app, executable: bundledExecutable };
}

function validateDualLauncherReceipt(receipt, safeSource, actionsSource) {
  validateStandaloneBuildReceipt(receipt, "darwin-arm64");
  const safe = receipt.launchers?.safe;
  const actions = receipt.launchers?.local_actions;
  for (const [record, mode, source] of [[safe, "safe", safeSource], [actions, "local-actions", actionsSource]]) {
    if (record?.mode !== mode || record.name !== path.basename(source)
        || record.bytes !== fs.statSync(source).size || record.sha256 !== digestFile(source)) {
      throw new Error(`macOS ${mode} SEA executable does not match its build receipt.`);
    }
  }
  const expectedIndex = digest(jsonBytes([safe, actions]));
  if (receipt.unsigned_asset_index_sha256 !== expectedIndex
      || receipt.executable !== safe.name
      || receipt.executable_bytes !== safe.bytes
      || receipt.executable_sha256 !== safe.sha256) {
    throw new Error("macOS dual-launcher asset index does not match its build receipt.");
  }
}

export function createMacosStandaloneApp({ safeExecutable, localActionsExecutable, buildReceipt, outDir }) {
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  const safeSource = regularFile(safeExecutable, "macOS safe SEA executable");
  const actionsSource = regularFile(localActionsExecutable, "macOS local-actions SEA executable");
  validateDualLauncherReceipt(receipt, safeSource, actionsSource);

  const output = path.resolve(outDir);
  if (fs.existsSync(output)) throw new Error(`macOS app output already exists: ${output}`);
  try {
    fs.mkdirSync(output, { recursive: true, mode: 0o755 });
    const safeBundle = createAppBundle({
      source: safeSource,
      output,
      definition: APP_DEFINITIONS.safe,
      version: receipt.version
    });
    const localActionsBundle = createAppBundle({
      source: actionsSource,
      output,
      definition: APP_DEFINITIONS.local_actions,
      version: receipt.version
    });
    const launcherReceipt = {
      safe: {
        mode: APP_DEFINITIONS.safe.mode,
        app_name: APP_DEFINITIONS.safe.appName,
        bundle_id: APP_DEFINITIONS.safe.bundleId,
        executable_path: `${APP_DEFINITIONS.safe.appName}/Contents/MacOS/${APP_DEFINITIONS.safe.executableName}`,
        unsigned_sea_sha256: digestFile(safeSource)
      },
      local_actions: {
        mode: APP_DEFINITIONS.local_actions.mode,
        app_name: APP_DEFINITIONS.local_actions.appName,
        bundle_id: APP_DEFINITIONS.local_actions.bundleId,
        executable_path: `${APP_DEFINITIONS.local_actions.appName}/Contents/MacOS/${APP_DEFINITIONS.local_actions.executableName}`,
        unsigned_sea_sha256: digestFile(actionsSource)
      }
    };
    const appReceipt = {
      schema_version: 2,
      version: receipt.version,
      commit: receipt.commit,
      launchers: launcherReceipt,
      bundle_id: launcherReceipt.safe.bundle_id,
      app_name: launcherReceipt.safe.app_name,
      executable_path: launcherReceipt.safe.executable_path,
      unsigned_sea_sha256: launcherReceipt.safe.unsigned_sea_sha256
    };
    fs.writeFileSync(path.join(output, "macos-app-receipt.json"), jsonBytes(appReceipt), { flag: "wx", mode: 0o644 });
    return {
      output,
      app: safeBundle.app,
      executable: safeBundle.executable,
      localActionsApp: localActionsBundle?.app,
      localActionsExecutable: localActionsBundle?.executable,
      launchers: {
        safe: safeBundle,
        local_actions: localActionsBundle
      },
      receipt: appReceipt
    };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    if (!args["safe-executable"] || !args["local-actions-executable"] || !args["build-receipt"] || !args.out) {
      throw new Error("Usage: node scripts/standalone-macos-app.mjs --safe-executable=<safe-darwin-arm64-sea> --local-actions-executable=<actions-darwin-arm64-sea> --build-receipt=<prototype-receipt.json> --out=<new-directory>");
    }
    const result = createMacosStandaloneApp({
      safeExecutable: args["safe-executable"],
      localActionsExecutable: args["local-actions-executable"],
      buildReceipt: args["build-receipt"],
      outDir: args.out
    });
    console.log(JSON.stringify({
      status: "created-unsigned-macos-launchers",
      launchers: Object.fromEntries(Object.entries(result.launchers).map(([key, value]) => [key, value.app])),
      commit: result.receipt.commit
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "macOS standalone apps could not be created.");
    process.exitCode = 1;
  }
}
