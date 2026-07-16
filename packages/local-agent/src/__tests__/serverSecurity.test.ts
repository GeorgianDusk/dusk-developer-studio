// @vitest-environment node

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentServer, type LocalAgentServerOptions } from "../server";

const ORIGIN = "http://127.0.0.1:5173";
const PAIRING_TOKEN = "t".repeat(32);
const servers = new Set<http.Server>();

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

async function startServer(options: Partial<LocalAgentServerOptions> = {}): Promise<{ server: http.Server; port: number }> {
  const server = createLocalAgentServer({ pairingToken: PAIRING_TOKEN, port: 0, ...options });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return { server, port: (server.address() as AddressInfo).port };
}

function request(port: number, options: { method?: string; path?: string; origin?: string | null; host?: string; session?: string; headers?: Record<string, string>; body?: string; omitContentLength?: boolean } = {}): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const body = options.body;
    const headers: Record<string, string | number> = {
      host: options.host ?? `127.0.0.1:${port}`,
      ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
      ...(body !== undefined && !options.omitContentLength ? { "content-length": Buffer.byteLength(body) } : {}),
      ...options.headers
    };
    if (options.session) headers["cookie"] = options.session;
    const clientRequest = http.request({ hostname: "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/health", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
      });
    });
    clientRequest.on("error", reject);
    if (body !== undefined) clientRequest.write(body);
    clientRequest.end();
  });
}

function slowPairRequest(port: number): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/pair",
      headers: {
        host: `127.0.0.1:${port}`,
        origin: ORIGIN,
        "content-type": "text/plain",
        "content-length": Buffer.byteLength(PAIRING_TOKEN)
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
      });
    });
    clientRequest.on("error", reject);
    clientRequest.write("x");
  });
}

async function pair(port: number): Promise<string> {
  const response = await request(port, {
    method: "POST",
    path: "/pair",
    headers: { "content-type": "text/plain" },
    body: PAIRING_TOKEN
  });
  expect(response.status).toBe(200);
  const setCookie = response.headers["set-cookie"];
  expect(setCookie).toBeDefined();
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0];
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

describe("local companion containment boundary", () => {
  it("refuses short pairing tokens and non-loopback origins at startup", () => {
    expect(() => createLocalAgentServer({ pairingToken: "short" })).toThrow(/at least 32/);
    expect(() => createLocalAgentServer({ pairingToken: PAIRING_TOKEN, allowedOrigins: ["https://studio.example"] })).toThrow(/loopback/);
    expect(() => createLocalAgentServer({ pairingToken: PAIRING_TOKEN, allowedOrigins: ["http://[::1]:5173"] })).toThrow(/loopback/);
  });

  it("rejects missing origins and untrusted Host headers", async () => {
    const { port } = await startServer();
    const missingOrigin = await request(port, { origin: null });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.code).toBe("origin_denied");
    expect(missingOrigin.headers["access-control-allow-origin"]).toBeUndefined();
    for (const untrustedOrigin of ["null", "https://attacker.example", "https://studio.example"]) {
      const response = await request(port, { origin: untrustedOrigin });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("origin_denied");
    }
    for (const untrustedHost of ["attacker.example", "127.0.0.1", `[::1]:${port}`]) {
      const response = await request(port, { host: untrustedHost });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("host_denied");
    }
  });

  it("requires the correct pairing token and returns only an HttpOnly session cookie", async () => {
    const { port } = await startServer();
    const wrong = await request(port, { method: "POST", path: "/pair", headers: { "content-type": "text/plain" }, body: "x".repeat(32) });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("pairing_failed");

    const cookie = await pair(port);
    expect(cookie).toMatch(/^dusk_studio_session=/);
    const health = await request(port, { session: cookie });
    expect(health.status).toBe(200);
    expect(health.headers["access-control-allow-credentials"]).toBe("true");
    expect(health.headers["set-cookie"]).toBeUndefined();
  });

  it("rate-limits pairing attempts before accepting another credential", async () => {
    const { port } = await startServer({ pairAttemptsPerMinute: 2 });
    for (let attempt = 0; attempt < 2; attempt += 1) { const response = await request(port, { method: "POST", path: "/pair", headers: { "content-type": "text/plain" }, body: "x".repeat(32) }); expect(response.status).toBe(401); expect(response.body.code).toBe("pairing_failed"); }
    const limited = await request(port, { method: "POST", path: "/pair", headers: { "content-type": "text/plain" }, body: PAIRING_TOKEN }); expect(limited.status).toBe(429); expect(limited.body.code).toBe("rate_limited");
  });

  it("rotates the browser session when the same origin pairs again", async () => {
    const { port } = await startServer();
    const firstCookie = await pair(port);
    const secondCookie = await pair(port);
    expect(secondCookie).not.toBe(firstCookie);
    const oldSession = await request(port, { session: firstCookie });
    const newSession = await request(port, { session: secondCookie });
    expect(oldSession.status).toBe(401);
    expect(newSession.status).toBe(200);
  });

  it("expires paired sessions", async () => {
    const { port } = await startServer({ sessionTtlMs: 10 });
    const cookie = await pair(port);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await request(port, { session: cookie });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("pairing_required");
  });

  it("authenticates before parsing capability request bodies", async () => {
    const { port } = await startServer({ capabilitiesEnabled: true });
    const response = await request(port, {
      method: "POST",
      path: "/scaffold-template",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("pairing_required");
  });

  it("keeps health diagnostics minimal and capabilities disabled by default", async () => {
    const runPreflight = vi.fn();
    const { port } = await startServer({ workspaceRoot: "C:\\private\\workspace", dependencies: { runPreflight } });
    const cookie = await pair(port);
    const health = await request(port, { session: cookie });
    expect(health.body).toEqual({ ok: true, service: "dusk-studio-local-agent", paired: true, capabilitiesEnabled: false });
    expect(JSON.stringify(health.body)).not.toContain("workspace");
    expect(JSON.stringify(health.body)).not.toContain("allowedOrigins");

    const preflight = await request(port, { path: "/preflight", session: cookie });
    expect(preflight.status).toBe(403);
    expect(preflight.body.code).toBe("capabilities_disabled");
    expect(runPreflight).not.toHaveBeenCalled();
  });

  it("returns only a validated bounded release identity when configured", async () => {
    const releaseIdentity = { product: "Dusk Developer Studio", version: "0.1.0", commit: "a".repeat(40), channel: "portable" };
    const { port } = await startServer({ releaseIdentity }); const cookie = await pair(port); const health = await request(port, { session: cookie });
    expect(health.body.release).toEqual(releaseIdentity);
    expect(() => createLocalAgentServer({ pairingToken: PAIRING_TOKEN, releaseIdentity: { ...releaseIdentity, product: "x".repeat(81) } })).toThrow();
    expect(() => createLocalAgentServer({ pairingToken: PAIRING_TOKEN, releaseIdentity: { ...releaseIdentity, commit: "not-a-commit" } })).toThrow();
  });

  it("validates CORS preflights and denies Private Network Access by default", async () => {
    const { port } = await startServer();
    const unpaired = await request(port, { method: "OPTIONS", path: "/health", headers: { "access-control-request-method": "GET" } });
    expect(unpaired.status).toBe(401);

    const pairPreflight = await request(port, { method: "OPTIONS", path: "/pair", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expect(pairPreflight.status).toBe(204);
    expect(pairPreflight.headers["access-control-allow-private-network"]).toBeUndefined();

    await pair(port);
    const pairedCapabilityPreflight = await request(port, { method: "OPTIONS", path: "/scaffold-template", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expect(pairedCapabilityPreflight.status).toBe(204);

    const privateNetwork = await request(port, { method: "OPTIONS", path: "/pair", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type", "access-control-request-private-network": "true" } });
    expect(privateNetwork.status).toBe(403);
    expect(privateNetwork.body.code).toBe("private_network_denied");
  });

  it("emits Private Network Access authorization only after pairing when explicitly enabled", async () => {
    const { port } = await startServer({ allowPrivateNetwork: true });
    const bootstrap = await request(port, { method: "OPTIONS", path: "/pair", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type", "access-control-request-private-network": "true" } });
    expect(bootstrap.status).toBe(403);
    await pair(port);
    const authorized = await request(port, { method: "OPTIONS", path: "/health", headers: { "access-control-request-method": "GET", "access-control-request-private-network": "true" } });
    expect(authorized.status).toBe(204);
    expect(authorized.headers["access-control-allow-private-network"]).toBe("true");
  });

  it("rejects oversized request bodies before comparing credentials", async () => {
    const { port } = await startServer({ bodyLimitBytes: 16 });
    const response = await request(port, { method: "POST", path: "/pair", headers: { "content-type": "text/plain" }, body: PAIRING_TOKEN });
    expect(response.status).toBe(413);
    expect(response.body.code).toBe("body_too_large");
    const chunked = await request(port, { method: "POST", path: "/pair", headers: { "content-type": "text/plain" }, body: PAIRING_TOKEN, omitContentLength: true });
    expect(chunked.status).toBe(413);
    expect(chunked.body.code).toBe("body_too_large");
  });

  it("times out a slow request body", async () => {
    const { port } = await startServer({ bodyTimeoutMs: 50 });
    const response = await slowPairRequest(port);
    expect(response.status).toBe(408);
    expect(response.body.code).toBe("body_timeout");
  });

  it("enforces content type and JSON shape after authentication", async () => {
    const scaffoldFoundryTemplate = vi.fn();
    const { port } = await startServer({ capabilitiesEnabled: true, dependencies: { scaffoldFoundryTemplate } });
    const cookie = await pair(port);
    const wrongType = await request(port, { method: "POST", path: "/scaffold-template", session: cookie, headers: { "content-type": "text/plain" }, body: "{}" });
    const invalidJson = await request(port, { method: "POST", path: "/scaffold-template", session: cookie, headers: { "content-type": "application/json" }, body: "{not-json" });
    const unexpectedField = await request(port, { method: "POST", path: "/scaffold-template", session: cookie, headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "safe", command: "whoami" }) });
    expect(wrongType.status).toBe(415);
    expect(invalidJson.status).toBe(400);
    expect(unexpectedField.status).toBe(400);
    expect(scaffoldFoundryTemplate).not.toHaveBeenCalled();
  });

  it("redacts local paths and raw tool errors from authenticated preflight output", async () => {
    const runPreflight = vi.fn(() => ({
      ok: false,
      checkedAt: "2026-07-10T00:00:00.000Z",
      path: "evm" as const,
      tools: [{ name: "Forge", command: "forge", ok: false, required: true, version: "C:\\Users\\person\\forge.exe\n1.2.3", error: "secret detail C:\\Users\\person", installHint: "Install Foundry." }]
    }));
    const { port } = await startServer({ capabilitiesEnabled: true, dependencies: { runPreflight } });
    const cookie = await pair(port);
    const response = await request(port, { path: "/preflight", session: cookie });
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("person");
    expect(serialized).not.toContain("secret detail");
    expect(serialized).toContain("[local-path]");
    expect(serialized).toContain("Check failed.");
  });

  it("rate-limits and serializes authenticated capability requests", async () => {
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const runPreflight = vi.fn(async () => {
      started();
      await new Promise<void>((resolve) => { release = resolve; });
      return { ok: true, checkedAt: "2026-07-10T00:00:00.000Z", path: "evm" as const, tools: [] };
    });
    const { port } = await startServer({ capabilitiesEnabled: true, capabilityRequestsPerMinute: 2, dependencies: { runPreflight } });
    const cookie = await pair(port);
    const first = request(port, { path: "/preflight", session: cookie });
    await startedPromise;
    const busy = await request(port, { path: "/preflight", session: cookie });
    expect(busy.status).toBe(429);
    expect(busy.body.code).toBe("capability_busy");
    release();
    expect((await first).status).toBe(200);
    const limited = await request(port, { path: "/preflight", session: cookie });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
  });

  it("rate-limits authenticated health requests", async () => {
    const { port } = await startServer({ sessionRequestsPerMinute: 2 });
    const cookie = await pair(port);
    expect((await request(port, { session: cookie })).status).toBe(200);
    expect((await request(port, { session: cookie })).status).toBe(200);
    const limited = await request(port, { session: cookie });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
  });
});
