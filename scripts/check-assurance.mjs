import fs from "node:fs";
import path from "node:path";
import { validateAssuranceReceipt } from "./assurance-metadata.mjs";

try {
  const root = path.resolve(process.cwd());
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "apps", "studio", "dist", "assurance-receipt.json"), "utf8"));
  const result = validateAssuranceReceipt(root, receipt);
  console.log(`Assurance parity verified across ${result.sourceUrls} source links and ${result.assets.total_bytes} budgeted bytes.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Assurance validation failed.");
  process.exitCode = 1;
}
