import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const REQUIRED_PREDEPLOY_ASSURANCE = ["dependency_audit", "secret_scan", "browser_matrix", "source_access"];
const SYNTHETIC_USER_AGENT = "DuskStudioSynthetic/1.0 (+https://github.com/GeorgianDusk/dusk-developer-studio)";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchBounded(url, options = {}) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await globalThis.fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
    const limit = options.maxBytes ?? 2_000_000;
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw new Error(`${url} exceeds the ${limit}-byte response limit.`);
    const chunks = [];
    let total = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          throw new Error(`${url} exceeds the ${limit}-byte response limit.`);
        }
        chunks.push(Buffer.from(value));
      }
    }
    return { response, body: Buffer.concat(chunks, total) };
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchAvailability(url, timeoutMs = 10_000, httpsGet = https.get, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "https:") { reject(new Error(`Source URL must use HTTPS: ${target}`)); return; }
    const request = httpsGet(target, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "user-agent": SYNTHETIC_USER_AGENT
      }
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      response.resume();
      if (status >= 300 && status < 400 && location) {
        if (redirectCount >= 3) { reject(new Error(`${target} exceeded the redirect limit.`)); return; }
        const next = new URL(location, target);
        if (next.protocol !== "https:") { reject(new Error(`${target} redirected outside HTTPS.`)); return; }
        fetchAvailability(next, timeoutMs, httpsGet, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 400) reject(new Error(`${target} returned ${status}.`));
      else resolve(status);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`${target} availability check timed out.`)));
    request.once("error", reject);
  });
}

export function validatePublicHeaders(headers, kind = "html") {
  const blockers = [];
  const required = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"];
  if (kind === "html") {
    for (const header of required) if (!headers.get(header)) blockers.push(`Missing ${header}.`);
    const csp = headers.get("content-security-policy") ?? "";
    if (!csp.includes("frame-ancestors 'none'") || !csp.includes("form-action 'none'")) blockers.push("CSP is missing frame/form protections.");
    if (/127\.0\.0\.1:8788|localhost:8788/i.test(csp)) blockers.push("CSP exposes the local companion port.");
    if (!/no-cache/i.test(headers.get("cache-control") ?? "")) blockers.push("HTML cache policy is not no-cache.");
  }
  if (kind === "health" && !/no-store/i.test(headers.get("cache-control") ?? "")) blockers.push("Health cache policy is not no-store.");
  if (kind === "receipt" && !/no-store/i.test(headers.get("cache-control") ?? "")) blockers.push("Receipt cache policy is not no-store.");
  if (kind === "asset" && (!/public/i.test(headers.get("cache-control") ?? "") || !/immutable/i.test(headers.get("cache-control") ?? ""))) blockers.push("Hashed asset cache policy is not public/immutable.");
  return blockers;
}

export function validateReleaseDocuments(manifest, assurance, options = {}) {
  const blockers = [];
  if (!manifest || manifest.schema_version !== 2 || manifest.product !== "Dusk Developer Studio") blockers.push("Release manifest identity/schema is invalid.");
  if (!COMMIT_RE.test(manifest?.commit ?? "")) blockers.push("Release candidate does not identify one clean full Git commit.");
  if (options.expectedCommit && manifest?.commit !== options.expectedCommit) blockers.push(`Release commit is ${manifest?.commit ?? "missing"}, expected ${options.expectedCommit}.`);
  if (manifest?.environment !== (options.expectedEnvironment ?? "staging")) blockers.push(`Release environment is ${manifest?.environment ?? "missing"}, expected ${options.expectedEnvironment ?? "staging"}.`);
  for (const gate of REQUIRED_PREDEPLOY_ASSURANCE) if (manifest?.assurance?.[gate] !== "passed") blockers.push(`Predeployment assurance ${gate} has not passed.`);
  if (!assurance || assurance.schema_version !== 1 || assurance.assets?.status !== "passed" || assurance.deployment_headers?.status !== "passed" || assurance.source_links_and_schema?.status !== "passed") blockers.push("Assurance receipt is incomplete.");
  const assuranceBytes = Buffer.from(JSON.stringify(assurance, null, 2) + "\n");
  if (manifest?.assurance_receipt_sha256 !== sha256(assuranceBytes)) blockers.push("Assurance receipt digest does not match the release manifest.");
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  if (!artifacts.length || artifacts.some((artifact) => !artifact.path || !SHA256_RE.test(artifact.sha256 ?? "") || !Number.isInteger(artifact.bytes))) blockers.push("Release manifest artifact records are invalid.");
  return blockers;
}

function checkTls(hostname, minimumDays) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: true });
    socket.setTimeout(10_000);
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      const expiresAt = Date.parse(certificate.valid_to);
      const daysRemaining = (expiresAt - Date.now()) / 86_400_000;
      if (!Number.isFinite(daysRemaining) || daysRemaining < minimumDays) reject(new Error(`TLS certificate has ${daysRemaining.toFixed(1)} days remaining.`));
      else resolve({ status: "passed", days_remaining: Number(daysRemaining.toFixed(1)), expires_at: new Date(expiresAt).toISOString() });
    });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("TLS inspection timed out.")); });
    socket.once("error", reject);
  });
}

export function checkPublicPortClosed(hostname, port, connect = net.connect) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port });
    let settled = false;
    const pass = (observed) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ status: "passed", observed });
    };
    socket.setTimeout(3_000, () => pass("filtered-or-closed"));
    socket.once("connect", () => {
      settled = true;
      socket.destroy();
      reject(new Error(`Public port ${port} accepted a connection.`));
    });
    socket.once("error", (error) => {
      if (["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(error.code)) pass(error.code.toLowerCase());
      else if (!settled) reject(error);
    });
  });
}

async function checkRpc(rpcUrl, expectedChainId) {
  const { response, body } = await fetchBounded(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    maxBytes: 64_000
  });
  if (!response.ok) throw new Error(`Testnet RPC returned ${response.status}.`);
  const payload = JSON.parse(body.toString("utf8"));
  if (payload.result !== expectedChainId) throw new Error(`Testnet RPC returned chain ${payload.result ?? "missing"}, expected ${expectedChainId}.`);
  return { status: "passed", chain_id: payload.result };
}

export async function runStagingSmoke(options) {
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:") throw new Error("Staging smoke requires HTTPS.");
  if (!options.policy.candidate_hosts.includes(baseUrl.hostname)) throw new Error(`Target host ${baseUrl.hostname} is not approved by Phase 5 policy.`);
  const checks = {};
  const errors = [];
  const record = async (name, operation) => {
    try { checks[name] = await operation(); }
    catch (error) { checks[name] = { status: "failed" }; errors.push(`${name}: ${error instanceof Error ? error.message : "unknown failure"}`); }
  };

  let manifest;
  let assurance;
  await record("public_health", async () => {
    const { response, body } = await fetchBounded(new URL("/healthz", baseUrl), { maxBytes: 64 });
    const blockers = validatePublicHeaders(response.headers, "health");
    if (!response.ok || body.toString("utf8").trim() !== "ok" || blockers.length) throw new Error(blockers.join(" ") || `Health returned ${response.status}.`);
    return { status: "passed" };
  });
  await record("key_routes", async () => {
    const { response, body } = await fetchBounded(new URL("/", baseUrl), { maxBytes: 64_000 });
    const fallback = await fetchBounded(new URL("/not-a-real-studio-file", baseUrl), { maxBytes: 64_000 });
    const blockers = [...validatePublicHeaders(response.headers, "html"), ...validatePublicHeaders(fallback.response.headers, "html")];
    const html = body.toString("utf8");
    const fallbackHtml = fallback.body.toString("utf8");
    if (!response.ok || !fallback.response.ok || !html.includes("<title>Dusk Developer Studio</title>") || !fallbackHtml.includes("<title>Dusk Developer Studio</title>") || blockers.length) throw new Error(blockers.join(" ") || "Public HTML identity or SPA fallback is stale.");
    return { status: "passed", spa_fallback_cache: "no-cache" };
  });
  await record("release_parity", async () => {
    const manifestResult = await fetchBounded(new URL("/release-manifest.json", baseUrl), { maxBytes: 256_000 });
    const assuranceResult = await fetchBounded(new URL("/assurance-receipt.json", baseUrl), { maxBytes: 256_000 });
    const headerBlockers = [...validatePublicHeaders(manifestResult.response.headers, "receipt"), ...validatePublicHeaders(assuranceResult.response.headers, "receipt")];
    if (!/application\/json/i.test(manifestResult.response.headers.get("content-type") ?? "") || !/application\/json/i.test(assuranceResult.response.headers.get("content-type") ?? "")) throw new Error("Release receipts are not served as JSON.");
    manifest = JSON.parse(manifestResult.body.toString("utf8"));
    assurance = JSON.parse(assuranceResult.body.toString("utf8"));
    const blockers = [...headerBlockers, ...validateReleaseDocuments(manifest, assurance, {
      expectedEnvironment: options.expectedEnvironment,
      expectedCommit: options.expectedCommit
    })];
    if (blockers.length) throw new Error(blockers.join(" "));
    for (const artifact of manifest.artifacts) {
      const artifactResult = await fetchBounded(new URL(`/${artifact.path}`, baseUrl), { maxBytes: Math.max(artifact.bytes + 1, 64_000) });
      if (!artifactResult.response.ok || artifactResult.body.byteLength !== artifact.bytes || sha256(artifactResult.body) !== artifact.sha256) throw new Error(`Artifact parity failed for ${artifact.path}.`);
      if (artifact.path.startsWith("assets/")) {
        const cacheBlockers = validatePublicHeaders(artifactResult.response.headers, "asset");
        if (cacheBlockers.length) throw new Error(cacheBlockers.join(" "));
      }
    }
    return { status: "passed", commit: manifest.commit, version: manifest.version, artifact_fingerprint_sha256: sha256(JSON.stringify(manifest.artifacts)) };
  });
  await record("source_links", async () => {
    const statuses = {};
    for (const url of options.policy.key_source_urls) statuses[url] = await fetchAvailability(url);
    return { status: "passed", urls: statuses };
  });
  await record("rpc_chain_id", () => checkRpc(options.rpcUrl, options.policy.expected_testnet_chain_id));
  await record("rpc_degradation", async () => {
    if (options.rpcDegradationStatus !== "success" && options.rpcDegradationStatus !== "passed") throw new Error("Hosted browser RPC degradation test did not pass in this run.");
    return { status: "passed", evidence: "hosted-browser-offline-recovery" };
  });
  await record("tls_expiry", () => checkTls(baseUrl.hostname, options.policy.minimum_tls_days_remaining));
  await record("development_port_closed", () => checkPublicPortClosed(baseUrl.hostname, 5173));
  await record("companion_port_closed", () => checkPublicPortClosed(baseUrl.hostname, 8788));

  return {
    schema_version: 1,
    checked_at: new Date().toISOString(),
    target: baseUrl.origin,
    expected_environment: options.expectedEnvironment,
    status: errors.length ? "failed" : "passed",
    checks,
    errors
  };
}
