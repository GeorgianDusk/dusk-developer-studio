// @vitest-environment node

import fs from "node:fs/promises";
import http from "node:http";
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

function request(port: number, options: { method?: string; path?: string; origin?: string; host?: string; contentType?: string; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/", headers: {
      host: options.host ?? `127.0.0.1:${port}`,
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.contentType ? { "content-type": options.contentType } : {})
    } }, (res) => { const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })); });
    req.once("error", reject); req.end(options.method === "POST" ? (options.body ?? "{}") : undefined);
  });
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); servers.clear();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("portable local static server", () => {
  it("serves hardened files and completes a one-time same-origin bootstrap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-static-")); roots.push(root);
    await fs.writeFile(path.join(root, "index.html"), "<title>Local</title>");
    let observedToken = "";
    const companion = http.createServer((req, res) => { const chunks: Buffer[] = []; req.on("data", (chunk) => chunks.push(Buffer.from(chunk))); req.on("end", () => { observedToken = Buffer.concat(chunks).toString(); res.writeHead(200, { "content-type": "application/json", "set-cookie": "dusk_studio_session=test; HttpOnly; SameSite=Strict; Path=/" }); res.end('{"ok":true,"paired":true,"expiresInSeconds":1800}'); }); });
    const companionPort = await listen(companion);
    const server = await createLocalStudioServer({ studioRoot: root, port: 5173, companionPort, pairingToken: "p".repeat(43) });
    const port = await listen(server);
    const page = await request(port);
    expect(page.status).toBe(200); expect(page.headers["content-security-policy"]).toContain(`http://127.0.0.1:${companionPort}`); expect(page.headers["cache-control"]).toBe("no-store");
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
});
