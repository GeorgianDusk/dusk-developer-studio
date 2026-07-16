import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const RECEIPT_NAME = "assurance-receipt.json";
const SOURCE_FILES = ["capabilities.json", "networks.evm.json", "resources.json", "source-freshness.json", "troubleshooting.json"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}


function walk(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, base));
    else if (entry.isFile() && ![RECEIPT_NAME, "release-manifest.json"].includes(entry.name)) files.push(path.relative(base, absolute).replaceAll(path.sep, "/"));
  }
  return files.sort();
}

function collectUrls(value, urls = []) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https:\/\/[^\s)"']+/g)) urls.push(match[0].replace(/[.,;]+$/, ""));
  } else if (Array.isArray(value)) value.forEach((item) => collectUrls(item, urls));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectUrls(item, urls));
  return urls;
}

function validateSources(root, policy) {
  const sourceRoot = path.join(root, "data", "dusk");
  const digests = {};
  const hosts = new Set();
  const ids = new Set();
  let urlCount = 0;
  for (const name of SOURCE_FILES) {
    const file = path.join(sourceRoot, name);
    const contents = fs.readFileSync(file);
    const data = JSON.parse(contents.toString("utf8"));
    digests[name] = sha256(contents);
    if (Array.isArray(data)) {
      for (const item of data) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) throw new Error(`${name} contains a record without an id.`);
        const key = `${name}:${item.id}`;
        if (ids.has(key)) throw new Error(`${name} contains duplicate id ${item.id}.`);
        ids.add(key);
      }
    }
    for (const raw of collectUrls(data)) {
      let url;
      try { url = new URL(raw); } catch { throw new Error(`${name} contains an invalid source URL.`); }
      if (url.protocol !== "https:") throw new Error(`${name} contains a non-HTTPS source URL.`);
      if (!policy.allowed_source_hosts.includes(url.hostname)) throw new Error(`${name} contains an unapproved source host: ${url.hostname}.`);
      hosts.add(url.hostname);
      urlCount += 1;
    }
  }
  return { status: "passed", record_ids: ids.size, url_count: urlCount, hosts: [...hosts].sort(), file_sha256: digests };
}

function validateHeaders(root, policy) {
  const configs = ["deploy/nginx.conf", "deploy/caddy/studio.caddy"];
  for (const relative of configs) {
    const content = fs.readFileSync(path.join(root, relative), "utf8");
    for (const header of policy.required_security_headers) {
      if (!content.includes(header)) throw new Error(`${relative} is missing ${header}.`);
    }
    if (!content.includes("frame-ancestors 'none'") || !content.includes("form-action 'none'")) throw new Error(`${relative} has an incomplete CSP boundary.`);
    if (/reverse_proxy|proxy_pass/i.test(content)) throw new Error(`${relative} must not proxy the local companion.`);
    let receiptCacheValid = false;
    if (relative.endsWith(".caddy")) receiptCacheValid = content.includes('@receipts path /release-manifest.json /assurance-receipt.json') && content.includes('header @receipts Cache-Control "no-store"');
    else {
      const receiptStart = content.indexOf("location ~ ^/(release-manifest|assurance-receipt)\\.json$");
      const receiptEnd = receiptStart >= 0 ? content.indexOf("\n  }", receiptStart) : -1;
      const receiptBlock = receiptStart >= 0 && receiptEnd > receiptStart ? content.slice(receiptStart, receiptEnd) : "";
      receiptCacheValid = receiptBlock.includes('add_header Cache-Control "no-store" always;');
    }
    if (!receiptCacheValid) throw new Error(`${relative} must serve release receipts with no-store caching.`);
  }
  return { status: "passed", configs };
}

function validateAssets(root, policy) {
  const dist = path.join(root, "apps", "studio", "dist");
  const totals = { javascript_bytes: 0, css_bytes: 0, html_bytes: 0, total_bytes: 0 };
  for (const relative of walk(dist)) {
    const bytes = fs.statSync(path.join(dist, relative)).size;
    totals.total_bytes += bytes;
    if (relative.endsWith(".js")) totals.javascript_bytes += bytes;
    if (relative.endsWith(".css")) totals.css_bytes += bytes;
    if (relative.endsWith(".html")) totals.html_bytes += bytes;
  }
  for (const [metric, budget] of Object.entries(policy.asset_budgets)) {
    if (totals[metric] > budget) throw new Error(`Asset budget exceeded for ${metric}: ${totals[metric]} > ${budget}.`);
  }
  return { status: "passed", observed: totals, budgets: policy.asset_budgets };
}

export function createAssuranceReceipt(root) {
  const policyPath = path.join(root, "config", "assurance-policy.json");
  const policyBytes = fs.readFileSync(policyPath);
  const policy = JSON.parse(policyBytes.toString("utf8"));
  if (policy.schema_version !== 1) throw new Error("Unsupported assurance policy schema.");
  return {
    schema_version: 1,
    policy_sha256: sha256(policyBytes),
    assets: validateAssets(root, policy),
    deployment_headers: validateHeaders(root, policy),
    source_links_and_schema: validateSources(root, policy),
    required_browser_projects: policy.required_browser_projects,
    lab_performance_budgets: policy.lab_performance_budgets
  };
}

export function writeAssuranceReceipt(root) {
  const receipt = createAssuranceReceipt(root);
  const destination = path.join(root, "apps", "studio", "dist", RECEIPT_NAME);
  fs.writeFileSync(destination, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return { receipt, destination };
}

export function validateAssuranceReceipt(root, receipt) {
  const expected = createAssuranceReceipt(root);
  if (JSON.stringify(receipt) !== JSON.stringify(expected)) throw new Error("Assurance receipt parity check failed.");
  return { assets: expected.assets.observed, sourceUrls: expected.source_links_and_schema.url_count };
}

export function artifactFingerprint(root) {
  const dist = path.join(root, "apps", "studio", "dist");
  const records = walk(dist).map((relative) => {
    const bytes = fs.readFileSync(path.join(dist, relative));
    return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return sha256(JSON.stringify(records));
}
