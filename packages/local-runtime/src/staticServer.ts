import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const MAX_BOOTSTRAP_RESPONSE_BYTES = 8 * 1024;
const MAX_BOOTSTRAP_REQUEST_BYTES = 1024;
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

export interface LocalStaticServerOptions {
  studioRoot: string;
  port: number;
  companionPort: number;
  pairingToken: string;
  bootstrapTtlMs?: number;
  now?: () => number;
}

function securityHeaders(companionPort: number): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://${HOST}:${companionPort}; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`,
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}

function sendJson(response: http.ServerResponse, status: number, body: unknown, companionPort: number, extra: Record<string, string | string[]> = {}): void {
  response.writeHead(status, { ...securityHeaders(companionPort), "content-type": "application/json; charset=utf-8", ...extra });
  response.end(JSON.stringify(body));
}

function validHost(host: string | undefined, port: number): boolean {
  return host?.toLowerCase() === `${HOST}:${port}` || host?.toLowerCase() === `localhost:${port}`;
}

function validBootstrapOrigin(origin: string | undefined, port: number): boolean {
  return origin === `http://${HOST}:${port}` || origin === `http://localhost:${port}`;
}

async function proxyPair(companionPort: number, origin: string, pairingToken: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: HOST,
      port: companionPort,
      path: "/pair",
      method: "POST",
      headers: {
        host: `${HOST}:${companionPort}`,
        origin,
        "content-type": "text/plain",
        "content-length": Buffer.byteLength(pairingToken)
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes <= MAX_BOOTSTRAP_RESPONSE_BYTES) chunks.push(buffer);
      });
      response.on("end", () => {
        if (bytes > MAX_BOOTSTRAP_RESPONSE_BYTES) reject(new Error("Companion bootstrap response exceeded its bound."));
        else resolve({ status: response.statusCode ?? 502, headers: response.headers, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error("Companion bootstrap timed out.")));
    request.once("error", reject);
    request.end(pairingToken);
  });
}

async function safeStaticPath(realRoot: string, pathname: string): Promise<string | undefined> {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some((part) => part === ".." || (part.startsWith(".") && part !== ""))) return undefined;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(realRoot, relative);
  const rel = path.relative(realRoot, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    const real = await fs.realpath(candidate);
    const realRel = path.relative(realRoot, real);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) return undefined;
    return real;
  } catch { return undefined; }
}

function isSafeStaticRequestPath(realRoot: string, pathname: string): boolean {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some((part) => part === ".." || (part.startsWith(".") && part !== ""))) return false;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(realRoot, relative);
  const rel = path.relative(realRoot, candidate);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

class LocalRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function readBootstrapBody(request: http.IncomingMessage): Promise<void> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BOOTSTRAP_REQUEST_BYTES) throw new LocalRequestError(413, "body_too_large", "Portable bootstrap request exceeded its bound.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BOOTSTRAP_REQUEST_BYTES) throw new LocalRequestError(413, "body_too_large", "Portable bootstrap request exceeded its bound.");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new LocalRequestError(400, "invalid_json", "Portable bootstrap request was not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 0) throw new LocalRequestError(400, "invalid_request", "Portable bootstrap request must be an empty JSON object.");
}

export async function createLocalStudioServer(options: LocalStaticServerOptions): Promise<http.Server> {
  const realRoot = await fs.realpath(path.resolve(options.studioRoot));
  const indexPath = await safeStaticPath(realRoot, "/");
  if (!indexPath) throw new Error("Portable Studio index is missing or unsafe.");
  const now = options.now ?? Date.now;
  const bootstrapExpiresAt = now() + (options.bootstrapTtlMs ?? 5 * 60 * 1000);
  let bootstrapAvailable = true;

  const server = http.createServer(async (request, response) => {
    try {
      const address = server.address();
      const listeningPort = address && typeof address !== "string" ? (address as AddressInfo).port : options.port;
      if (!validHost(request.headers.host, listeningPort)) {
        sendJson(response, 403, { ok: false, code: "host_denied" }, options.companionPort); return;
      }
      const url = new URL(request.url ?? "/", `http://${HOST}:${listeningPort}`);
      if (url.pathname === "/__dusk/bootstrap") {
        if (request.method !== "POST") { sendJson(response, 405, { ok: false, code: "method_denied" }, options.companionPort, { allow: "POST" }); return; }
        const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
        const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        if (!validBootstrapOrigin(origin, listeningPort) || contentType !== "application/json" || request.headers["sec-fetch-site"] === "cross-site") {
          sendJson(response, 403, { ok: false, code: "bootstrap_denied" }, options.companionPort); return;
        }
        if (!bootstrapAvailable || now() > bootstrapExpiresAt) {
          bootstrapAvailable = false;
          sendJson(response, 410, { ok: false, code: "bootstrap_expired" }, options.companionPort); return;
        }
        await readBootstrapBody(request);
        const paired = await proxyPair(options.companionPort, origin!, options.pairingToken);
        if (paired.status === 200) bootstrapAvailable = false;
        const setCookie = paired.headers["set-cookie"];
        response.writeHead(paired.status, {
          ...securityHeaders(options.companionPort),
          "content-type": "application/json; charset=utf-8",
          ...(setCookie ? { "set-cookie": setCookie } : {})
        });
        response.end(paired.body); return;
      }
      if (url.pathname === "/healthz") {
        if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { ok: false, code: "method_denied" }, options.companionPort, { allow: "GET, HEAD" }); return; }
        response.writeHead(200, { ...securityHeaders(options.companionPort), "content-type": "text/plain; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : "ok"); return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { ok: false, code: "method_denied" }, options.companionPort, { allow: "GET, HEAD" }); return;
      }
      if (!isSafeStaticRequestPath(realRoot, url.pathname)) {
        sendJson(response, 404, { ok: false, code: "not_found" }, options.companionPort); return;
      }
      const requested = await safeStaticPath(realRoot, url.pathname);
      const file = requested ?? indexPath;
      const body = request.method === "HEAD" ? undefined : await fs.readFile(file);
      response.writeHead(200, { ...securityHeaders(options.companionPort), "content-type": MIME.get(path.extname(file).toLowerCase()) ?? "application/octet-stream" });
      response.end(body);
    } catch (error) {
      if (error instanceof LocalRequestError) sendJson(response, error.status, { ok: false, code: error.code }, options.companionPort);
      else sendJson(response, 503, { ok: false, code: "local_runtime_unavailable" }, options.companionPort);
    }
  });
  return server;
}
