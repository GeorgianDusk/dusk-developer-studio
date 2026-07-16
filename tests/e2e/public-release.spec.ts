import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const expectedEnvironment = process.env.DUSK_STUDIO_EXPECTED_ENVIRONMENT ?? "staging";
const requiresPublicCandidate = expectedEnvironment === "staging" || expectedEnvironment === "production";
const routes = [
  ["overview", "Pick the execution model your app actually needs."],
  ["setup", "Prove your RPC, wallet network, account, and balance read."],
  ["access", "Confirm testnet DUSK is available for gas."],
  ["build", "Create, build, and test the Counter starter."],
  ["inspect", "Read an address, transaction, or block from Testnet."],
  ["reference", "Deeper context, with source receipts."],
  ["troubleshooting", "Fix the blocker in front of you."],
  ["companion", "Machine actions are unavailable in this build."],
  ["settings", "Know exactly what this build knows."]
] as const;

test("public candidate exposes the exact release across key routes", async ({ page, request }) => {
  const rootResponse = await request.get("/");
  expect(rootResponse.ok()).toBeTruthy();
  if (requiresPublicCandidate) {
    const rootHeaders = rootResponse.headers();
    expect(rootHeaders["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(rootHeaders["content-security-policy"]).not.toMatch(/127\.0\.0\.1:8788|localhost:8788/i);
    expect(rootHeaders["cache-control"]).toMatch(/no-cache/i);
  }

  for (const [route, heading] of routes) {
    await page.goto(`/#${route}`);
    await expect(page).toHaveTitle("Dusk Developer Studio");
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  const manifestResponse = await request.get("/release-manifest.json");
  const assuranceResponse = await request.get("/assurance-receipt.json");
  expect(manifestResponse.headers()["content-type"]).toMatch(/application\/json/i);
  expect(assuranceResponse.headers()["content-type"]).toMatch(/application\/json/i);
  if (requiresPublicCandidate) {
    expect(manifestResponse.headers()["cache-control"]).toMatch(/no-store/i);
    expect(assuranceResponse.headers()["cache-control"]).toMatch(/no-store/i);
  }
  const manifest = await manifestResponse.json();
  const assuranceBody = await assuranceResponse.body();
  expect(manifest).toMatchObject({ schema_version: 2, product: "Dusk Developer Studio", environment: expectedEnvironment });
  expect(manifest.commit).toMatch(requiresPublicCandidate ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{40}(?:-dirty)?$/);
  expect(createHash("sha256").update(assuranceBody).digest("hex")).toBe(manifest.assurance_receipt_sha256);
  for (const artifact of manifest.artifacts as Array<{ path: string; sha256: string; bytes: number }>) {
    const response = await request.get(`/${artifact.path}`);
    const body = await response.body();
    expect(response.ok(), artifact.path).toBeTruthy();
    expect(body.byteLength, artifact.path).toBe(artifact.bytes);
    expect(createHash("sha256").update(body).digest("hex"), artifact.path).toBe(artifact.sha256);
  }
});

test("public candidate presents a controlled offline RPC recovery", async ({ page, context }) => {
  await page.goto("/#setup");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Run RPC check" }).click();
  await expect(page.getByRole("alert")).toContainText(/browser could not reach|RPC request failed|timed out/i);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await context.setOffline(false);
});
