import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";

const APP_NAME = "Dusk Developer Studio.app";
const BUNDLE_ID = "network.dusk.developer-studio";
const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const COMMIT_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}

export function createMacosStandaloneApp({ executable, buildReceipt, outDir }) {
  const source = regularFile(executable, "macOS SEA executable");
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  if (receipt.schema_version !== 2 || receipt.status !== "private-nonpublication-prototype" || receipt.channel !== "node-sea-in-process"
      || receipt.target !== "darwin-arm64" || !VERSION_RE.test(receipt.version ?? "") || !COMMIT_RE.test(receipt.commit ?? "")
      || receipt.executable !== path.basename(source) || receipt.executable_sha256 !== digestFile(source)) throw new Error("macOS SEA executable does not match its build receipt.");
  const output = path.resolve(outDir);
  if (fs.existsSync(output)) throw new Error(`macOS app output already exists: ${output}`);
  const app = path.join(output, APP_NAME);
  try {
  const macos = path.join(app, "Contents", "MacOS");
  fs.mkdirSync(macos, { recursive: true, mode: 0o755 });
  const bundledExecutable = path.join(macos, "dusk-studio");
  fs.copyFileSync(source, bundledExecutable, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(bundledExecutable, 0o755);
  const plist = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"https://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\"><dict>",
    "<key>CFBundleDevelopmentRegion</key><string>en</string>",
    "<key>CFBundleDisplayName</key><string>Dusk Developer Studio</string>",
    "<key>CFBundleExecutable</key><string>dusk-studio</string>",
    `<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>`,
    "<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>",
    "<key>CFBundleName</key><string>Dusk Developer Studio</string>",
    "<key>CFBundlePackageType</key><string>APPL</string>",
    `<key>CFBundleShortVersionString</key><string>${receipt.version}</string>`,
    `<key>CFBundleVersion</key><string>${receipt.version}</string>`,
    "<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>",
    "<key>NSHighResolutionCapable</key><true/>",
    "</dict></plist>",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(app, "Contents", "Info.plist"), plist, { flag: "wx", mode: 0o644 });
  const appReceipt = { schema_version: 1, bundle_id: BUNDLE_ID, app_name: APP_NAME, version: receipt.version, commit: receipt.commit, executable_path: `${APP_NAME}/Contents/MacOS/dusk-studio`, unsigned_sea_sha256: receipt.executable_sha256 };
  fs.writeFileSync(path.join(output, "macos-app-receipt.json"), `${JSON.stringify(appReceipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  return { output, app, executable: bundledExecutable, receipt: appReceipt };
}

  catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    if (!args.executable || !args["build-receipt"] || !args.out) throw new Error("Usage: node scripts/standalone-macos-app.mjs --executable=<darwin-arm64-sea> --build-receipt=<prototype-receipt.json> --out=<new-directory>");
    const result = createMacosStandaloneApp({ executable: args.executable, buildReceipt: args["build-receipt"], outDir: args.out });
    console.log(JSON.stringify({ status: "created-unsigned-macos-app", app: result.app, executable: result.executable, commit: result.receipt.commit }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "macOS standalone app creation failed."); process.exitCode = 1; }
}
