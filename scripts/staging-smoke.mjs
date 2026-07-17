import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const DUSKDS_BLOCK_HASH_RE = /^[a-f0-9]{64}$/i;
const DUSKDS_GRAPHQL_QUERY = "query { block(height: -1) { header { height hash } } }";
const REQUIRED_PREDEPLOY_ASSURANCE = ["dependency_audit", "secret_scan", "browser_matrix", "source_access"];
const SYNTHETIC_USER_AGENT = "DuskStudioSynthetic/1.0 (+https://github.com/GeorgianDusk/dusk-developer-studio)";
export const ASSURANCE_CHECK_OWNERSHIP = Object.freeze({
  public_health: "studio",
  key_routes: "studio",
  release_parity: "studio",
  source_links: "upstream",
  duskds_node_read: "upstream",
  rpc_degradation: "studio",
  tls_expiry: "studio",
  development_port_closed: "studio",
  companion_port_closed: "studio"
});
export const STUDIO_ASSURANCE_INCIDENT_TITLE = "Studio public deployment assurance failed";
export const UPSTREAM_ASSURANCE_INCIDENT_TITLE = "Studio upstream dependency unavailable";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchBounded(url, options = {}) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await globalThis.fetch(url, { ...options, signal: controller.signal, redirect: options.redirect ?? "error" });
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

export function validateAssuranceTargetOrigin(value, policy) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("Public assurance target must be one valid URL.");
  }
  if (target.protocol !== "https:") throw new Error("Public assurance target must use HTTPS.");
  if (target.username || target.password) throw new Error("Public assurance target must not contain user information.");
  if (target.port) throw new Error("Public assurance target must use the default HTTPS port.");
  if (target.href !== `${target.origin}/`) throw new Error("Public assurance target must be an exact origin with no path, query, or fragment.");
  if (!Array.isArray(policy?.candidate_hosts) || !policy.candidate_hosts.includes(target.hostname)) {
    throw new Error(`Target host ${target.hostname} is not approved by Phase 5 policy.`);
  }
  return target;
}

export function validateStudioEvidenceResponse(requestedUrl, expectedOrigin, response) {
  const requested = new URL(requestedUrl);
  let finalUrl;
  try {
    finalUrl = new URL(response?.url);
  } catch {
    throw new Error(`Studio evidence for ${requested.pathname} has no valid final URL.`);
  }
  if (response.redirected === true || (response.status >= 300 && response.status < 400)) {
    throw new Error(`Studio evidence for ${requested.pathname} must not follow or accept redirects.`);
  }
  if (requested.origin !== expectedOrigin || finalUrl.origin !== expectedOrigin || finalUrl.href !== requested.href) {
    throw new Error(`Studio evidence for ${requested.pathname} did not finish at the exact requested origin and URL.`);
  }
}

export async function fetchStudioEvidence(baseUrl, pathname, options = {}, boundedFetch = fetchBounded) {
  const target = new URL(pathname, baseUrl);
  if (target.origin !== baseUrl.origin) throw new Error(`Studio evidence path ${pathname} escapes the approved origin.`);
  const result = await boundedFetch(target, { ...options, redirect: "manual" });
  validateStudioEvidenceResponse(target, baseUrl.origin, result.response);
  return result;
}

export function classifyAssuranceChecks(checks) {
  const observedChecks = checks && typeof checks === "object" && !Array.isArray(checks) ? checks : {};
  const ownedChecks = Object.entries(ASSURANCE_CHECK_OWNERSHIP);
  const studioChecks = ownedChecks.filter(([, owner]) => owner === "studio").map(([name]) => name);
  const upstreamChecks = ownedChecks.filter(([, owner]) => owner === "upstream").map(([name]) => name);
  const unclassifiedChecks = Object.keys(observedChecks).filter((name) => {
    if (Object.hasOwn(ASSURANCE_CHECK_OWNERSHIP, name)) return false;
    return !(name === "rpc_chain_id" && observedChecks[name]?.status === "deferred");
  });
  const groupStatus = (names) => names.every((name) => observedChecks[name]?.status === "passed") ? "passed" : "failed";
  return {
    studio_status: groupStatus([...studioChecks, ...unclassifiedChecks]),
    upstream_dependency_status: groupStatus(upstreamChecks)
  };
}

export function selectAssuranceIncidentTitle(browserOutcome, syntheticOutcome, classification = {}) {
  return browserOutcome === "success"
    && syntheticOutcome === "failure"
    && classification.studio_status === "passed"
    && classification.upstream_dependency_status === "failed"
    ? UPSTREAM_ASSURANCE_INCIDENT_TITLE
    : STUDIO_ASSURANCE_INCIDENT_TITLE;
}

function normalizeDuskDsHeight(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d{1,16}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  throw new Error("DuskDS Testnet GraphQL returned an invalid or unbounded block height.");
}

export async function checkDuskDsNodeRead(graphqlUrl, boundedFetch = fetchBounded, now = () => new Date()) {
  let target;
  try {
    target = new URL(graphqlUrl);
  } catch {
    throw new Error("DuskDS Testnet GraphQL policy URL is invalid.");
  }
  if (target.protocol !== "https:" || target.hostname !== "testnet.nodes.dusk.network"
      || target.username || target.password || target.port
      || target.pathname !== "/on/graphql/query" || target.search || target.hash) {
    throw new Error("DuskDS Testnet GraphQL policy URL must be the exact official HTTPS endpoint.");
  }
  const { response, body } = await boundedFetch(target, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: DUSKDS_GRAPHQL_QUERY,
    maxBytes: 64_000,
    redirect: "error"
  });
  if (response.redirected === true || (response.status >= 300 && response.status < 400) || response.url !== target.href) {
    throw new Error("DuskDS Testnet GraphQL must not redirect or change its exact URL.");
  }
  if (!response.ok) throw new Error(`DuskDS Testnet GraphQL returned ${response.status}.`);
  const payload = JSON.parse(body.toString("utf8"));
  if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error("DuskDS Testnet GraphQL returned query errors.");
  const height = normalizeDuskDsHeight(payload?.block?.header?.height);
  const hash = payload?.block?.header?.hash;
  if (typeof hash !== "string" || !DUSKDS_BLOCK_HASH_RE.test(hash)) {
    throw new Error("DuskDS Testnet GraphQL returned an invalid 64-hex block hash.");
  }
  return {
    status: "passed",
    endpoint: target.href,
    height,
    hash: hash.toLowerCase(),
    observed_at: now().toISOString()
  };
}

function deferredRpcChainId(policy) {
  const deferral = policy?.deferred_synthetic_checks?.rpc_chain_id;
  if (deferral?.path !== "evm" || typeof deferral.reason !== "string" || !deferral.reason.trim() || deferral.reason.length > 300) {
    throw new Error("DuskEVM RPC deferral policy is missing or invalid.");
  }
  return { status: "deferred", path: "evm", reason: deferral.reason };
}

export async function runStagingSmoke(options) {
  const baseUrl = validateAssuranceTargetOrigin(options.baseUrl, options.policy);
  const checks = {};
  const errors = [];
  const record = async (name, operation) => {
    try { checks[name] = await operation(); }
    catch (error) { checks[name] = { status: "failed" }; errors.push(`${name}: ${error instanceof Error ? error.message : "unknown failure"}`); }
  };

  let manifest;
  let assurance;
  await record("public_health", async () => {
    const { response, body } = await fetchStudioEvidence(baseUrl, "/healthz", { maxBytes: 64 });
    const blockers = validatePublicHeaders(response.headers, "health");
    if (!response.ok || body.toString("utf8").trim() !== "ok" || blockers.length) throw new Error(blockers.join(" ") || `Health returned ${response.status}.`);
    return { status: "passed" };
  });
  await record("key_routes", async () => {
    const { response, body } = await fetchStudioEvidence(baseUrl, "/", { maxBytes: 64_000 });
    const fallback = await fetchStudioEvidence(baseUrl, "/not-a-real-studio-file", { maxBytes: 64_000 });
    const blockers = [...validatePublicHeaders(response.headers, "html"), ...validatePublicHeaders(fallback.response.headers, "html")];
    const html = body.toString("utf8");
    const fallbackHtml = fallback.body.toString("utf8");
    if (!response.ok || !fallback.response.ok || !html.includes("<title>Dusk Developer Studio</title>") || !fallbackHtml.includes("<title>Dusk Developer Studio</title>") || blockers.length) throw new Error(blockers.join(" ") || "Public HTML identity or SPA fallback is stale.");
    return { status: "passed", spa_fallback_cache: "no-cache" };
  });
  await record("release_parity", async () => {
    const manifestResult = await fetchStudioEvidence(baseUrl, "/release-manifest.json", { maxBytes: 256_000 });
    const assuranceResult = await fetchStudioEvidence(baseUrl, "/assurance-receipt.json", { maxBytes: 256_000 });
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
      const artifactResult = await fetchStudioEvidence(baseUrl, `/${artifact.path}`, { maxBytes: Math.max(artifact.bytes + 1, 64_000) });
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
  await record("duskds_node_read", () => checkDuskDsNodeRead(options.policy.duskds_testnet_graphql_url));
  checks.rpc_chain_id = deferredRpcChainId(options.policy);
  await record("rpc_degradation", async () => {
    if (options.rpcDegradationStatus !== "success" && options.rpcDegradationStatus !== "passed") throw new Error("Hosted browser RPC degradation test did not pass in this run.");
    return { status: "passed", evidence: "hosted-browser-offline-recovery" };
  });
  await record("tls_expiry", () => checkTls(baseUrl.hostname, options.policy.minimum_tls_days_remaining));
  await record("development_port_closed", () => checkPublicPortClosed(baseUrl.hostname, 5173));
  await record("companion_port_closed", () => checkPublicPortClosed(baseUrl.hostname, 8788));

  const classification = classifyAssuranceChecks(checks);
  return {
    schema_version: 1,
    checked_at: new Date().toISOString(),
    target: baseUrl.origin,
    expected_environment: options.expectedEnvironment,
    status: errors.length ? "failed" : "passed",
    ...classification,
    checks,
    errors
  };
}
