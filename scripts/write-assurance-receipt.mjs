import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAssuranceReceipt } from "./assurance-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { receipt, destination } = writeAssuranceReceipt(root);
console.log(`Assurance receipt wrote ${receipt.source_links_and_schema.url_count} source links and ${receipt.assets.observed.total_bytes} budgeted bytes to ${destination}.`);
