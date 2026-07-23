// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStudioServer } from "../staticServer";

const servers = new Set<http.Server>();
const roots: string[] = [];

function listen(server: http.Server): Promise<number> {
  servers.add(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function request(port: number, options: { method?: string; path?: string; origin?: string; host?: string; contentType?: string; cookie?: string; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/", headers: {
      host: options.host ?? `127.0.0.1:${port}`,
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.contentType ? { "content-type": options.contentType } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {})
    } }, (res) => { const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })); });
    req.once("error", reject); req.end(options.method === "POST" ? (options.body ?? "{}") : undefined);
  });
}

function incompleteBootstrapRequest(port: number): Promise<{ response: string; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write([
        "POST /__dusk/bootstrap HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        `Origin: http://127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Content-Length: 100",
        "Connection: close",
        "",
        "{"
      ].join("\r\n"));
    });
    const guard = setTimeout(() => {
      socket.destroy();
      reject(new Error("Incomplete bootstrap connection did not close within its bounded test window."));
    }, 2_000);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("error", (error) => {
      clearTimeout(guard);
      reject(error);
    });
    socket.once("close", () => {
      clearTimeout(guard);
      resolve({ response: Buffer.concat(chunks).toString("utf8"), elapsedMs: Date.now() - started });
    });
  });
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); servers.clear();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("npm local static server", () => {
  it("maps companion authentication loss to a bounded same-origin session status", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-session-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "ok");
    const companion = http.createServer((req, res) => {
      if (req.url !== "/health" || req.headers.origin === undefined) {
        res.writeHead(400).end(); return;
      }
      if (req.headers.cookie !== "dusk_studio_session=current") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"ok":false,"code":"pairing_required"}'); return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true,"service":"dusk-studio-local-agent","paired":true,"capabilitiesEnabled":true}');
    });
    const companionPort = await listen(companion);
    const server = await createLocalStudioServer({ studioRoot: root, port: 5173, companionPort, pairingToken: "p".repeat(43) });
    const port = await listen(server);
    const unpaired = await request(port, { path: "/__dusk/session" });
    expect(unpaired.status).toBe(200);
    expect(JSON.parse(unpaired.body)).toEqual({ ok: true, paired: false });
    const paired = await request(port, { path: "/__dusk/session", cookie: "dusk_studio_session=current" });
    expect(paired.status).toBe(200);
    expect(JSON.parse(paired.body)).toMatchObject({ paired: true, capabilitiesEnabled: true });
    expect(paired.headers["set-cookie"]).toBeUndefined();
  });

  it("serves preliminary GET and HEAD requests without consuming the one-time same-origin bootstrap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "<title>Local</title>");
    let observedToken = "";
    const companion = http.createServer((req, res) => { const chunks: Buffer[] = []; req.on("data", (chunk) => chunks.push(Buffer.from(chunk))); req.on("end", () => { observedToken = Buffer.concat(chunks).toString(); res.writeHead(200, { "content-type": "application/json", "set-cookie": "dusk_studio_session=test; HttpOnly; SameSite=Strict; Path=/" }); res.end('{"ok":true,"paired":true,"expiresInSeconds":1800}'); }); });
    const companionPort = await listen(companion);
    const server = await createLocalStudioServer({ studioRoot: root, port: 5173, companionPort, pairingToken: "p".repeat(43) });
    const port = await listen(server);
    const page = await request(port);
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain(`http://127.0.0.1:${companionPort}`);
    expect(page.headers["content-security-policy"]).toContain(`http://localhost:${companionPort}`);
    expect(page.headers["content-security-policy"]).toContain("https://testnet.nodes.dusk.network");
    expect(page.headers["cache-control"]).toBe("no-store");
    const head = await request(port, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const denied = await request(port, { method: "POST", path: "/__dusk/bootstrap", origin: "https://attacker.example", contentType: "application/json" });
    expect(denied.status).toBe(403); expect(observedToken).toBe("");
    const origin = `http://127.0.0.1:${port}`;
    const paired = await request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json" });
    expect(paired.status).toBe(200); expect(paired.headers["set-cookie"]?.[0]).toContain("HttpOnly"); expect(observedToken).toBe("p".repeat(43)); expect(paired.body).not.toContain(observedToken);
    expect((await request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json" })).status).toBe(410);
  });

  it("rejects unsafe hosts and methods", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "ok");
    const server = await createLocalStudioServer({ studioRoot: root, port: 5173, companionPort: 8788, pairingToken: "p".repeat(43) });
    const port = await listen(server);
    expect((await request(port, { host: "attacker.example" })).status).toBe(403);
    expect((await request(port, { method: "POST", path: "/anything" })).status).toBe(405);
    expect((await request(port, { path: "/%2e%2e%2fsecret" })).status).toBe(404);
    expect((await request(port, { path: "/.env" })).status).toBe(404);
    expect((await request(port, { path: "/missing-spa-route" })).status).toBe(200);
    const origin = `http://127.0.0.1:${port}`;
    expect((await request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json", body: "x".repeat(1_025) })).status).toBe(413);
    expect((await request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json", body: "not-json" })).status).toBe(400);
  });

  it("closes an incomplete bootstrap body after the bounded request deadline", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-incomplete-body-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "ok");
    const server = await createLocalStudioServer({
      studioRoot: root,
      port: 5173,
      companionPort: 8788,
      pairingToken: "p".repeat(43),
      bootstrapBodyTimeoutMs: 50
    });
    const port = await listen(server);

    const incomplete = await incompleteBootstrapRequest(port);
    expect(incomplete.elapsedMs).toBeLessThan(1_000);
    expect(incomplete.response).toContain("HTTP/1.1 408");
    expect(incomplete.response).toContain('"code":"body_timeout"');
    expect(incomplete.response.toLowerCase()).toContain("connection: close");
    expect((await request(port, { path: "/healthz" })).status).toBe(200);
  });

  it("supports the localhost browser origin consistently with its CSP", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-localhost-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "ok");
    let studioPort = 0;
    let companionPort = 0;
    const companion = http.createServer((req, res) => {
      const expectedOrigin = `http://localhost:${studioPort}`;
      if (req.headers.host !== `localhost:${companionPort}` || req.headers.origin !== expectedOrigin) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end('{"ok":false,"code":"origin_denied"}'); return;
      }
      if (req.url === "/pair" && req.method === "POST") {
        req.resume();
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json", "set-cookie": "dusk_studio_session=test; HttpOnly; SameSite=Strict; Path=/" });
          res.end('{"ok":true,"paired":true,"expiresInSeconds":1800}');
        });
        return;
      }
      if (req.url === "/health" && req.method === "GET" && req.headers.cookie === "dusk_studio_session=test") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true,"service":"dusk-studio-local-agent","paired":true,"capabilitiesEnabled":true}'); return;
      }
      res.writeHead(404).end();
    });
    companionPort = await listen(companion);
    const server = await createLocalStudioServer({ studioRoot: root, port: 5173, companionPort, pairingToken: "p".repeat(43) });
    const port = await listen(server); studioPort = port;
    const host = `localhost:${port}`;
    const origin = `http://${host}`;

    const page = await request(port, { host });
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain(`http://localhost:${companionPort}`);
    expect((await request(port, {
      method: "POST",
      path: "/__dusk/bootstrap",
      host: `127.0.0.1:${port}`,
      origin,
      contentType: "application/json"
    })).status).toBe(403);
    expect((await request(port, {
      method: "POST",
      path: "/__dusk/bootstrap",
      host,
      origin: `http://127.0.0.1:${port}`,
      contentType: "application/json"
    })).status).toBe(403);
    const paired = await request(port, { method: "POST", path: "/__dusk/bootstrap", host, origin, contentType: "application/json" });
    expect(paired.status).toBe(200);
    expect(paired.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    const session = await request(port, { path: "/__dusk/session", host, cookie: "dusk_studio_session=test" });
    expect(session.status).toBe(200);
    expect(JSON.parse(session.body)).toMatchObject({ paired: true, capabilitiesEnabled: true });
  });

  it("allows only one bootstrap request to pair at a time", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-race-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "ok");
    let pairRequests = 0;
    let signalPairStarted!: () => void;
    let releasePair!: () => void;
    const pairStarted = new Promise<void>((resolve) => { signalPairStarted = resolve; });
    const pairGate = new Promise<void>((resolve) => { releasePair = resolve; });
    const companion = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        pairRequests += 1;
        signalPairStarted();
        void pairGate.then(() => {
          res.writeHead(200, { "content-type": "application/json", "set-cookie": "dusk_studio_session=test; HttpOnly; SameSite=Strict; Path=/" });
          res.end('{"ok":true,"paired":true,"expiresInSeconds":1800}');
        });
      });
    });
    const companionPort = await listen(companion);
    const server = await createLocalStudioServer({ studioRoot: root, port: 5173, companionPort, pairingToken: "p".repeat(43) });
    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;

    const first = request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json" });
    await pairStarted;
    const concurrent = await request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json" });
    expect(concurrent.status).toBe(409);
    expect(concurrent.body).toContain("bootstrap_in_progress");
    expect(pairRequests).toBe(1);
    releasePair();
    expect((await first).status).toBe(200);
    expect((await request(port, { method: "POST", path: "/__dusk/bootstrap", origin, contentType: "application/json" })).status).toBe(410);
  });
});
