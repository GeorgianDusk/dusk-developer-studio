import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const HOST = "127.0.0.1";
const DUSKDS_TESTNET_ORIGIN = "https://testnet.nodes.dusk.network";
const MAX_BOOTSTRAP_RESPONSE_BYTES = 8 * 1024;
const MAX_BOOTSTRAP_REQUEST_BYTES = 1024;
const DEFAULT_BOOTSTRAP_BODY_TIMEOUT_MS = 5_000;
const MAX_SESSION_STATUS_BYTES = 8 * 1024;
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
  bootstrapBodyTimeoutMs?: number;
  now?: () => number;
}

function securityHeaders(companionPort: number): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://${HOST}:${companionPort} http://localhost:${companionPort} ${DUSKDS_TESTNET_ORIGIN}; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`,
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

function validBootstrapOrigin(origin: string | undefined, host: string | undefined, port: number): boolean {
  const normalizedHost = host?.toLowerCase();
  return Boolean(
    origin
    && normalizedHost
    && validHost(normalizedHost, port)
    && origin.toLowerCase() === `http://${normalizedHost}`
  );
}

function loopbackHostnameForOrigin(origin: string): "127.0.0.1" | "localhost" {
  const hostname = new URL(origin).hostname.toLowerCase();
  if (hostname !== HOST && hostname !== "localhost") {
    throw new Error("Local Studio origin must use an approved loopback hostname.");
  }
  return hostname;
}

async function proxyPair(
  companionPort: number,
  origin: string,
  pairingToken: string,
  signal?: AbortSignal
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const companionHost = loopbackHostnameForOrigin(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: HOST,
      port: companionPort,
      path: "/pair",
      method: "POST",
      headers: {
        host: `${companionHost}:${companionPort}`,
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
    const abort = () => request.destroy(new Error("Companion bootstrap client disconnected."));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.once("close", () => signal?.removeEventListener("abort", abort));
    request.end(pairingToken);
  });
}

async function proxySessionStatus(
  companionPort: number,
  origin: string,
  cookie: string | undefined,
  signal?: AbortSignal
): Promise<{ status: number; body: Buffer }> {
  const companionHost = loopbackHostnameForOrigin(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: HOST,
      port: companionPort,
      path: "/health",
      method: "GET",
      headers: {
        host: `${companionHost}:${companionPort}`,
        origin,
        ...(cookie ? { cookie } : {})
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes <= MAX_SESSION_STATUS_BYTES) chunks.push(buffer);
      });
      response.on("end", () => {
        if (bytes > MAX_SESSION_STATUS_BYTES) reject(new Error("Companion session-status response exceeded its bound."));
        else resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(1_200, () => request.destroy(new Error("Companion session-status request timed out.")));
    const abort = () => request.destroy(new Error("Companion session-status client disconnected."));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.once("close", () => signal?.removeEventListener("abort", abort));
    request.end();
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

function readBootstrapBody(request: http.IncomingMessage, bodyTimeoutMs: number): Promise<void> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BOOTSTRAP_REQUEST_BYTES) throw new LocalRequestError(413, "body_too_large", "Local bootstrap request exceeded its bound.");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_BOOTSTRAP_REQUEST_BYTES) {
        request.pause();
        finish(() => reject(new LocalRequestError(413, "body_too_large", "Local bootstrap request exceeded its bound.")));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish(() => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reject(new LocalRequestError(400, "invalid_json", "Local bootstrap request was not valid JSON."));
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 0) {
        reject(new LocalRequestError(400, "invalid_request", "Local bootstrap request must be an empty JSON object."));
        return;
      }
      resolve();
    });
    const onError = () => finish(() => reject(new LocalRequestError(400, "body_read_failed", "Could not read the local bootstrap request.")));
    const onAborted = () => finish(() => reject(new LocalRequestError(400, "request_aborted", "Local bootstrap request was aborted.")));
    const timeout = setTimeout(() => {
      request.pause();
      finish(() => reject(new LocalRequestError(408, "body_timeout", "Local bootstrap request body timed out.")));
    }, bodyTimeoutMs);
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

export async function createLocalStudioServer(options: LocalStaticServerOptions): Promise<http.Server> {
  const realRoot = await fs.realpath(path.resolve(options.studioRoot));
  const indexPath = await safeStaticPath(realRoot, "/");
  if (!indexPath) throw new Error("Local Studio index is missing or unsafe.");
  const now = options.now ?? Date.now;
  const bootstrapBodyTimeoutMs = options.bootstrapBodyTimeoutMs ?? DEFAULT_BOOTSTRAP_BODY_TIMEOUT_MS;
  const bootstrapExpiresAt = now() + (options.bootstrapTtlMs ?? 5 * 60 * 1000);
  let bootstrapState: "available" | "in-flight" | "burned" = "available";

  const server = http.createServer(async (request, response) => {
    try {
      const address = server.address();
      const listeningPort = address && typeof address !== "string" ? (address as AddressInfo).port : options.port;
      if (!validHost(request.headers.host, listeningPort)) {
        sendJson(response, 403, { ok: false, code: "host_denied" }, options.companionPort); return;
      }
      const url = new URL(request.url ?? "/", `http://${HOST}:${listeningPort}`);
      if (url.pathname === "/__dusk/session") {
        if (request.method !== "GET") { sendJson(response, 405, { ok: false, code: "method_denied" }, options.companionPort, { allow: "GET" }); return; }
        if (request.headers["sec-fetch-site"] === "cross-site") {
          sendJson(response, 403, { ok: false, code: "session_status_denied" }, options.companionPort); return;
        }
        const origin = `http://${request.headers.host!.toLowerCase()}`;
        const clientAbort = new AbortController();
        const abortOnDisconnect = () => {
          if (!response.writableEnded) clientAbort.abort();
        };
        request.once("aborted", abortOnDisconnect);
        response.once("close", abortOnDisconnect);
        try {
          const status = await proxySessionStatus(
            options.companionPort,
            origin,
            typeof request.headers.cookie === "string" ? request.headers.cookie : undefined,
            clientAbort.signal
          );
          if (status.status === 401) {
            sendJson(response, 200, { ok: true, paired: false }, options.companionPort); return;
          }
          if (status.status !== 200) {
            sendJson(response, 503, { ok: false, code: "local_runtime_unavailable" }, options.companionPort); return;
          }
          response.writeHead(200, { ...securityHeaders(options.companionPort), "content-type": "application/json; charset=utf-8" });
          response.end(status.body); return;
        } finally {
          request.removeListener("aborted", abortOnDisconnect);
          response.removeListener("close", abortOnDisconnect);
        }
      }
      if (url.pathname === "/__dusk/bootstrap") {
        if (request.method !== "POST") { sendJson(response, 405, { ok: false, code: "method_denied" }, options.companionPort, { allow: "POST" }); return; }
        const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
        const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        if (!validBootstrapOrigin(origin, request.headers.host, listeningPort) || contentType !== "application/json" || request.headers["sec-fetch-site"] === "cross-site") {
          sendJson(response, 403, { ok: false, code: "bootstrap_denied" }, options.companionPort); return;
        }
        if (now() > bootstrapExpiresAt) bootstrapState = "burned";
        if (bootstrapState === "in-flight") {
          sendJson(response, 409, { ok: false, code: "bootstrap_in_progress" }, options.companionPort); return;
        }
        if (bootstrapState === "burned") {
          sendJson(response, 410, { ok: false, code: "bootstrap_expired" }, options.companionPort); return;
        }
        bootstrapState = "in-flight";
        const clientAbort = new AbortController();
        const abortOnDisconnect = () => {
          if (!response.writableEnded) clientAbort.abort();
        };
        request.once("aborted", abortOnDisconnect);
        response.once("close", abortOnDisconnect);
        try {
          await readBootstrapBody(request, bootstrapBodyTimeoutMs);
          const paired = await proxyPair(options.companionPort, origin!, options.pairingToken, clientAbort.signal);
          bootstrapState = paired.status === 200 || now() > bootstrapExpiresAt ? "burned" : "available";
          const setCookie = paired.headers["set-cookie"];
          response.writeHead(paired.status, {
            ...securityHeaders(options.companionPort),
            "content-type": "application/json; charset=utf-8",
            ...(setCookie ? { "set-cookie": setCookie } : {})
          });
          response.end(paired.body); return;
        } catch (error) {
          if (bootstrapState === "in-flight") bootstrapState = now() > bootstrapExpiresAt ? "burned" : "available";
          throw error;
        } finally {
          request.removeListener("aborted", abortOnDisconnect);
          response.removeListener("close", abortOnDisconnect);
        }
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
      if (error instanceof LocalRequestError) {
        sendJson(
          response,
          error.status,
          { ok: false, code: error.code },
          options.companionPort,
          error.status === 408 || error.status === 413 ? { connection: "close" } : {}
        );
      }
      else sendJson(response, 503, { ok: false, code: "local_runtime_unavailable" }, options.companionPort);
    }
  });
  return server;
}
