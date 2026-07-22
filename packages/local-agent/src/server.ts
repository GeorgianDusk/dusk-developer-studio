import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runPreflightAsync, type PreflightPath } from "./commands/preflight";
import { duskDsCounterForgeTemplateIdentity } from "../../templates/src/duskDsCounterForge";
import {
  ScaffoldRecoveryError,
  scaffoldDuskDsForge,
  type ScaffoldCompletionReceipt
} from "./commands/scaffoldDuskDsForge";
import { scaffoldFoundryTemplate } from "./commands/scaffoldTemplate";
import {
  assertBoundedScaffoldPath,
  assertWindowsForgeManagedRoot,
  MAX_SCAFFOLD_PATH_LENGTH,
  sanitizeProjectName,
  ScaffoldPathError,
  ScaffoldProjectNameError
} from "./commands/safePaths";

export { assertWindowsForgeManagedRoot, MAX_SCAFFOLD_PATH_LENGTH };
export { scaffoldDuskDsForge };

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const SESSION_COOKIE = "dusk_studio_session";
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_BODY_LIMIT_BYTES = 8 * 1024;
const DEFAULT_BODY_TIMEOUT_MS = 5_000;
const DEFAULT_PAIR_ATTEMPTS_PER_MINUTE = 5;
const DEFAULT_SESSION_REQUESTS_PER_MINUTE = 120;
const DEFAULT_CAPABILITY_REQUESTS_PER_MINUTE = 12;
const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];

const ScaffoldBodySchema = z.object({
  projectName: z.string().min(1).max(80),
  parentDir: z.string().max(MAX_SCAFFOLD_PATH_LENGTH)
    .refine((value) => !/[\0\r\n]/.test(value), "Parent folder contains a forbidden control character.")
    .optional()
}).strict();

const ReleaseIdentitySchema = z.object({
  product: z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/),
  version: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
  commit: z.string().min(7).max(64).regex(/^[0-9a-f]+$/),
  channel: z.string().min(1).max(32).regex(/^[a-z0-9][a-z0-9._-]*$/)
}).strict();

type PreflightResult = Awaited<ReturnType<typeof runPreflightAsync>>;
type ScaffoldResult = Awaited<ReturnType<typeof scaffoldFoundryTemplate>>;
type ForgeScaffoldResult = Awaited<ReturnType<typeof scaffoldDuskDsForge>>;

export interface LocalAgentDependencies {
  runPreflight: (path: PreflightPath) => PreflightResult | Promise<PreflightResult>;
  scaffoldFoundryTemplate: (options: { cwd: string; projectName: string; parentDir?: string }) => ScaffoldResult | Promise<ScaffoldResult>;
  scaffoldDuskDsForge: (options: { cwd: string; projectName: string; parentDir?: string }) => ForgeScaffoldResult | Promise<ForgeScaffoldResult>;
}

export interface LocalAgentReleaseIdentity {
  product: string;
  version: string;
  commit: string;
  channel: string;
}

export interface LocalAgentServerOptions {
  pairingToken: string;
  port?: number;
  workspaceRoot?: string;
  processCwd?: string;
  foundryTemplateRoot?: string;
  duskDsTemplateRoot?: string;
  duskDsProjectRoot?: string;
  releaseIdentity?: LocalAgentReleaseIdentity;
  allowedOrigins?: string[];
  capabilitiesEnabled?: boolean;
  evmScaffoldEnabled?: boolean;
  allowPrivateNetwork?: boolean;
  sessionTtlMs?: number;
  bodyLimitBytes?: number;
  bodyTimeoutMs?: number;
  pairAttemptsPerMinute?: number;
  sessionRequestsPerMinute?: number;
  capabilityRequestsPerMinute?: number;
  dependencies?: Partial<LocalAgentDependencies>;
}

interface Session { origin: string; expiresAt: number; }
interface RateWindow { count: number; resetsAt: number; }

class RequestError extends Error {
  constructor(readonly statusCode: number, readonly publicMessage: string, readonly code: string) {
    super(publicMessage);
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      && url.username === "" && url.password === "" && url.pathname === "/"
      && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function validatePairingToken(pairingToken: string): void {
  if (pairingToken.length < 32) {
    throw new Error("DUSK_STUDIO_PAIRING_TOKEN must contain at least 32 characters.");
  }
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(leftBuffer, Buffer.alloc(leftBuffer.length));
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readListeningPort(server: http.Server, fallbackPort: number): number {
  const address = server.address();
  return address && typeof address !== "string" ? (address as AddressInfo).port : fallbackPort;
}

function validHostHeader(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.toLowerCase();
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`;
}

function originMatchesHost(origin: string, hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader || !validHostHeader(hostHeader, port)) return false;
  try {
    const originHostname = new URL(origin).hostname.toLowerCase();
    const hostHostname = hostHeader.toLowerCase().slice(0, -`:${port}`.length);
    return originHostname === hostHostname;
  } catch {
    return false;
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "vary": "origin" };
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown, origin?: string, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? corsHeaders(origin) : {}),
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function sendError(response: http.ServerResponse, error: RequestError, origin?: string): void {
  sendJson(response, error.statusCode, { ok: false, error: error.publicMessage, code: error.code }, origin,
    error.statusCode === 408 || error.statusCode === 413 ? { connection: "close" } : {});
}

function requireContentType(request: http.IncomingMessage, expected: string): void {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== expected) {
    throw new RequestError(415, `Content-Type must be ${expected}.`, "unsupported_media_type");
  }
}

function readBody(request: http.IncomingMessage, bodyLimitBytes: number, bodyTimeoutMs: number): Promise<string> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > bodyLimitBytes) {
    throw new RequestError(413, "Request body is too large.", "body_too_large");
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      request.off("data", onData); request.off("end", onEnd);
      request.off("error", onError); request.off("aborted", onAborted);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true; cleanup(); callback();
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > bodyLimitBytes) {
        request.pause();
        finish(() => reject(new RequestError(413, "Request body is too large.", "body_too_large")));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks).toString("utf8")));
    const onError = () => finish(() => reject(new RequestError(400, "Could not read request body.", "body_read_failed")));
    const onAborted = () => finish(() => reject(new RequestError(400, "Request was aborted.", "request_aborted")));
    const timeout = setTimeout(() => {
      request.pause();
      finish(() => reject(new RequestError(408, "Request body timed out.", "body_timeout")));
    }, bodyTimeoutMs);
    request.on("data", onData); request.on("end", onEnd);
    request.on("error", onError); request.on("aborted", onAborted);
  });
}

async function readJson(request: http.IncomingMessage, bodyLimitBytes: number, bodyTimeoutMs: number): Promise<unknown> {
  requireContentType(request, "application/json");
  const raw = await readBody(request, bodyLimitBytes, bodyTimeoutMs);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new RequestError(400, "Request body must be valid JSON.", "invalid_json"); }
}

function readPreflightPath(url: URL): PreflightPath {
  return url.searchParams.get("path") === "duskds" ? "duskds" : "evm";
}

function safeVersion(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local-path]")
    .replace(/\/(?:Users|home|tmp|var|private|mnt)\/[^\s"'<>]+/g, "[local-path]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 128);
}

function sanitizePreflight(result: PreflightResult): PreflightResult {
  return {
    ok: result.ok, checkedAt: result.checkedAt, path: result.path,
    tools: result.tools.map((tool) => ({
      name: tool.name, command: tool.command, ok: tool.ok, required: tool.required,
      ...(tool.version ? { version: safeVersion(tool.version) } : {}),
      ...(!tool.ok ? { error: "Check failed." } : {}),
      ...(tool.failureKind ? { failureKind: tool.failureKind } : {}),
      ...(tool.installHint ? { installHint: tool.installHint } : {})
    }))
  };
}

function sanitizeDuskDsTemplateReceipt(result: ForgeScaffoldResult): {
  template: string;
  templateSource: string;
  templateRevision: string;
  templateLockSha256: string;
} {
  if (
    result.template !== duskDsCounterForgeTemplateIdentity.templateId
    || result.templateSource !== duskDsCounterForgeTemplateIdentity.upstreamRepository
    || result.templateRevision !== duskDsCounterForgeTemplateIdentity.upstreamRevision
    || result.templateLockSha256 !== duskDsCounterForgeTemplateIdentity.templateLockSha256
  ) {
    throw new Error("DuskDS reviewed-template receipt is invalid.");
  }
  return {
    template: result.template,
    templateSource: result.templateSource,
    templateRevision: result.templateRevision,
    templateLockSha256: result.templateLockSha256
  };
}

function sanitizeRuntimeOs(value: ForgeScaffoldResult["runtimeOs"]): "windows" | "linux" | "macos" {
  if (value !== "windows" && value !== "linux" && value !== "macos") {
    throw new Error("DuskDS scaffold runtime OS is invalid.");
  }
  return value;
}

function sanitizeCreatedProjectPath(
  result: ForgeScaffoldResult,
  projectName: string,
  runtimeOs: "windows" | "linux" | "macos"
): string {
  const created = result.path;
  const root = result.projectRoot;
  if (
    typeof created !== "string"
    || typeof root !== "string"
    || created.length < 2
    || created.length > 1_024
    || root.length < 1
    || root.length > 1_024
    || /[\0\r\n]/.test(created)
    || /[\0\r\n]/.test(root)
  ) {
    throw new Error("DuskDS scaffold path receipt is invalid.");
  }
  const pathApi = runtimeOs === "windows"
    ? /^[a-zA-Z]:[\\/]/.test(created) && /^[a-zA-Z]:[\\/]/.test(root) ? path.win32 : undefined
    : created.startsWith("/") && root.startsWith("/") ? path.posix : undefined;
  if (!pathApi) throw new Error("DuskDS scaffold path receipt is invalid.");
  const normalizedRoot = pathApi.resolve(root);
  const normalizedCreated = pathApi.resolve(created);
  const relative = pathApi.relative(normalizedRoot, normalizedCreated);
  if (
    !relative
    || relative.startsWith("..")
    || pathApi.isAbsolute(relative)
    || pathApi.basename(normalizedCreated) !== projectName
  ) {
    throw new Error("DuskDS scaffold path receipt is invalid.");
  }
  return normalizedCreated;
}

function consumeRateLimit(windows: Map<string, RateWindow>, key: string, maximum: number, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || current.resetsAt <= now) {
    windows.set(key, { count: 1, resetsAt: now + 60_000 });
    return true;
  }
  if (current.count >= maximum) return false;
  current.count += 1;
  return true;
}

export function createLocalAgentServer(options: LocalAgentServerOptions): http.Server {
  validatePairingToken(options.pairingToken);
  const releaseIdentity = options.releaseIdentity ? ReleaseIdentitySchema.parse(options.releaseIdentity) : undefined;
  const port = options.port ?? DEFAULT_PORT;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : path.resolve(__dirname, "../../..");
  const processCwd = options.processCwd?.trim() ? path.resolve(options.processCwd) : workspaceRoot;
  const foundryTemplateRoot = options.foundryTemplateRoot?.trim() ? path.resolve(options.foundryTemplateRoot) : undefined;
  const duskDsTemplateRoot = options.duskDsTemplateRoot?.trim() ? path.resolve(options.duskDsTemplateRoot) : undefined;
  const duskDsProjectRoot = options.duskDsProjectRoot?.trim()
    ? assertBoundedScaffoldPath(options.duskDsProjectRoot, "Configured DuskDS project root")
    : undefined;
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  if (allowedOrigins.size === 0 || [...allowedOrigins].some((origin) => !isLoopbackOrigin(origin))) {
    throw new Error("Local companion origins must be non-empty loopback HTTP origins.");
  }

  const capabilitiesEnabled = options.capabilitiesEnabled ?? false;
  const evmScaffoldEnabled = options.evmScaffoldEnabled ?? false;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
  const pairAttemptsPerMinute = options.pairAttemptsPerMinute ?? DEFAULT_PAIR_ATTEMPTS_PER_MINUTE;
  const sessionRequestsPerMinute = options.sessionRequestsPerMinute ?? DEFAULT_SESSION_REQUESTS_PER_MINUTE;
  const capabilityRequestsPerMinute = options.capabilityRequestsPerMinute ?? DEFAULT_CAPABILITY_REQUESTS_PER_MINUTE;
  const completedDuskDsScaffolds = new Map<string, ScaffoldCompletionReceipt>();
  const dependencies: LocalAgentDependencies = {
    runPreflight: (preflightPath) => runPreflightAsync(preflightPath, { cwd: processCwd }),
    scaffoldFoundryTemplate: (input) => scaffoldFoundryTemplate(input, foundryTemplateRoot ? { templateRoot: foundryTemplateRoot } : {}),
    scaffoldDuskDsForge: (input) => scaffoldDuskDsForge(input, {
      ...(duskDsProjectRoot ? { projectRoot: duskDsProjectRoot } : {}),
      ...(duskDsTemplateRoot ? { templateRoot: duskDsTemplateRoot } : {}),
      completedScaffoldReceipts: completedDuskDsScaffolds
    }),
    ...options.dependencies
  };
  const sessions = new Map<string, Session>();
  const pairWindows = new Map<string, RateWindow>();
  const sessionWindows = new Map<string, RateWindow>();
  const capabilityWindows = new Map<string, RateWindow>();
  let activeCapabilityRequests = 0;

  function requireOrigin(request: http.IncomingMessage, listeningPort: number): string {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
    if (!origin || !allowedOrigins.has(origin) || !originMatchesHost(origin, request.headers.host, listeningPort)) {
      throw new RequestError(403, "Origin is not allowed.", "origin_denied");
    }
    return origin;
  }

  function requireSession(request: http.IncomingMessage, origin: string): string {
    const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.origin !== origin || session.expiresAt <= Date.now()) {
      if (sessionId) sessions.delete(sessionId);
      throw new RequestError(401, "Pair with the local companion first.", "pairing_required");
    }
    if (!consumeRateLimit(sessionWindows, sessionId!, sessionRequestsPerMinute)) {
      throw new RequestError(429, "Too many local companion requests. Try again shortly.", "rate_limited");
    }
    return sessionId!;
  }

  function hasActiveSessionForOrigin(origin: string): boolean {
    const now = Date.now();
    let found = false;
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(sessionId);
      } else if (session.origin === origin) {
        found = true;
      }
    }
    return found;
  }

  function acquireCapability(sessionId: string): () => void {
    if (!capabilitiesEnabled) throw new RequestError(403, "Local companion capabilities are disabled.", "capabilities_disabled");
    if (!consumeRateLimit(capabilityWindows, sessionId, capabilityRequestsPerMinute)) {
      throw new RequestError(429, "Too many local capability requests. Try again shortly.", "rate_limited");
    }
    if (activeCapabilityRequests >= 1) throw new RequestError(429, "Another local capability request is already running.", "capability_busy");
    activeCapabilityRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeCapabilityRequests -= 1;
    };
  }

  const server = http.createServer(async (request, response) => {
    let origin: string | undefined;
    try {
      const listeningPort = readListeningPort(server, port);
      if (!validHostHeader(request.headers.host, listeningPort)) throw new RequestError(403, "Host is not allowed.", "host_denied");
      origin = requireOrigin(request, listeningPort);
      const requestUrl = new URL(request.url ?? "/", `http://${HOST}:${listeningPort}`);

      if (request.method === "OPTIONS") {
        const requestedMethod = request.headers["access-control-request-method"]?.toUpperCase();
        if (requestedMethod !== "GET" && requestedMethod !== "POST") throw new RequestError(403, "Requested method is not allowed.", "preflight_denied");
        const requestedHeaders = (request.headers["access-control-request-headers"] ?? "").split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
        if (requestedHeaders.some((header) => header !== "content-type")) throw new RequestError(403, "Requested headers are not allowed.", "preflight_denied");
        if (requestUrl.pathname !== "/pair" && !hasActiveSessionForOrigin(origin)) {
          throw new RequestError(401, "Pair with the local companion first.", "pairing_required");
        }
        if (!consumeRateLimit(sessionWindows, `preflight:${origin}`, sessionRequestsPerMinute)) {
          throw new RequestError(429, "Too many local companion requests. Try again shortly.", "rate_limited");
        }
        const privateNetworkRequested = request.headers["access-control-request-private-network"] === "true";
        if (privateNetworkRequested && (!allowPrivateNetwork || requestUrl.pathname === "/pair")) {
          throw new RequestError(403, "Private-network access is disabled.", "private_network_denied");
        }
        response.writeHead(204, {
          ...corsHeaders(origin),
          "access-control-allow-methods": requestedMethod,
          "access-control-allow-headers": requestedHeaders.join(", "),
          "access-control-max-age": "300",
          ...(privateNetworkRequested ? { "access-control-allow-private-network": "true" } : {})
        });
        response.end(); return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/pair") {
        if (!consumeRateLimit(pairWindows, origin, pairAttemptsPerMinute)) throw new RequestError(429, "Too many pairing attempts. Try again shortly.", "rate_limited");
        requireContentType(request, "text/plain");
        const submittedToken = await readBody(request, bodyLimitBytes, bodyTimeoutMs);
        if (!constantTimeEqual(submittedToken, options.pairingToken)) throw new RequestError(401, "Pairing token is invalid.", "pairing_failed");
        for (const [existingSessionId, session] of sessions) {
          if (session.origin === origin || session.expiresAt <= Date.now()) sessions.delete(existingSessionId);
        }
        const sessionId = randomBytes(32).toString("base64url");
        sessions.set(sessionId, { origin, expiresAt: Date.now() + sessionTtlMs });
        sendJson(response, 200, { ok: true, paired: true, expiresInSeconds: Math.floor(sessionTtlMs / 1000) }, origin, {
          "set-cookie": `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`
        });
        return;
      }

      const sessionId = requireSession(request, origin);
      if (request.method === "GET" && (requestUrl.pathname === "/health" || requestUrl.pathname === "/healthz")) {
        sendJson(response, 200, { ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled, ...(releaseIdentity ? { release: releaseIdentity } : {}) }, origin); return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/preflight") {
        const release = acquireCapability(sessionId);
        try { sendJson(response, 200, sanitizePreflight(await dependencies.runPreflight(readPreflightPath(requestUrl))), origin); }
        finally { release(); }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/scaffold-template") {
        if (!evmScaffoldEnabled) {
          throw new RequestError(
            403,
            "DuskEVM starter creation is not available before Testnet activation.",
            "evm_scaffold_unavailable"
          );
        }
        const release = acquireCapability(sessionId);
        try {
          const body = ScaffoldBodySchema.parse(await readJson(request, bodyLimitBytes, bodyTimeoutMs));
          const result = await dependencies.scaffoldFoundryTemplate({ cwd: workspaceRoot, projectName: body.projectName, parentDir: body.parentDir });
          sendJson(response, 200, { ok: true, projectName: body.projectName, structureVerified: result.structureVerified, files: result.files.slice(0, 256) }, origin);
        } finally { release(); }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/scaffold-duskds-forge") {
        const release = acquireCapability(sessionId);
        try {
          const body = ScaffoldBodySchema.parse(await readJson(request, bodyLimitBytes, bodyTimeoutMs));
          const projectName = sanitizeProjectName(body.projectName);
          if (projectName !== body.projectName) throw new ScaffoldProjectNameError();
          const result = await dependencies.scaffoldDuskDsForge({ cwd: workspaceRoot, projectName, parentDir: body.parentDir });
          const runtimeOs = sanitizeRuntimeOs(result.runtimeOs);
          sendJson(response, 200, {
            ok: true,
            projectName,
            projectPath: sanitizeCreatedProjectPath(result, projectName, runtimeOs),
            recovered: result.recovered,
            rustToolchain: result.rustToolchain,
            runtimeOs,
            structureVerified: result.structureVerified,
            files: result.files.slice(0, 256),
            ...sanitizeDuskDsTemplateReceipt(result)
          }, origin);
        } finally { release(); }
        return;
      }
      throw new RequestError(404, "Route not found.", "not_found");
    } catch (error) {
      if (error instanceof RequestError) { sendError(response, error, origin); return; }
      if (error instanceof ScaffoldPathError) {
        sendError(response, new RequestError(422, error.message, error.code), origin);
        return;
      }
      if (error instanceof ScaffoldProjectNameError) {
        sendError(response, new RequestError(422, error.message, error.code), origin);
        return;
      }
      if (error instanceof ScaffoldRecoveryError) {
        sendError(response, new RequestError(409, error.message, error.code), origin);
        return;
      }
      if (error instanceof z.ZodError) { sendError(response, new RequestError(400, "Request body is invalid.", "invalid_request"), origin); return; }
      const incidentId = randomUUID();
      console.error(`Local companion request failed [${incidentId}].`);
      sendJson(response, 500, { ok: false, error: "Local companion request failed.", code: "internal_error", incidentId }, origin);
    }
  });

  server.on("close", () => {
    sessions.clear();
    pairWindows.clear();
    sessionWindows.clear();
    capabilityWindows.clear();
    completedDuskDsScaffolds.clear();
  });
  return server;
}
