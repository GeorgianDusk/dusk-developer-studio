import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse, BrowserContext, Page } from "@playwright/test";

const configuredPublicUrl = process.env.DUSK_STUDIO_PUBLIC_URL?.replace(/\/$/, "");
const expectedEnvironment = process.env.DUSK_STUDIO_EXPECTED_ENVIRONMENT ?? (configuredPublicUrl ? "staging" : "local-preview");
const requiresPublicCandidate = expectedEnvironment === "staging" || expectedEnvironment === "production";
const publicOrigin = new URL(configuredPublicUrl ?? "http://127.0.0.1:5173").origin;
const allowedRpcOrigin = new URL("https://rpc.testnet.evm.dusk.network").origin;
const routes = [
  ["overview", "Pick the execution model your app actually needs."],
  ["setup", "Explore the planned DuskEVM developer workflow."],
  ["access", "Explore the planned DuskEVM developer workflow."],
  ["build", "Explore the planned DuskEVM developer workflow."],
  ["inspect", "Explore the planned DuskEVM developer workflow."],
  ["reference", "Source-backed context for the task in front of you."],
  ["troubleshooting", "Review DuskEVM launch-planning issues."],
  ["companion", "Use the hosted DuskDS guide manually today."],
  ["settings", "See the build you are using and control its saved progress."]
] as const;

async function getExact(request: APIRequestContext, pathname: string): Promise<APIResponse> {
  const expected = new URL(pathname, `${publicOrigin}/`);
  expect(expected.origin, pathname).toBe(publicOrigin);
  const response = await request.get(expected.href, { maxRedirects: 0 });
  expect(response.status(), pathname).not.toBeGreaterThanOrEqual(300);
  expect(response.url(), pathname).toBe(expected.href);
  expect(new URL(response.url()).origin, pathname).toBe(publicOrigin);
  return response;
}

async function installPublicRequestBoundary(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const isAllowedRpcRead = (request.resourceType() === "fetch" || request.resourceType() === "xhr") && requestUrl.origin === allowedRpcOrigin;
    if (requestUrl.origin !== publicOrigin && !isAllowedRpcRead) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function gotoExact(page: Page, pathname: string): Promise<void> {
  const expected = new URL(pathname, `${publicOrigin}/`);
  const expectedRequest = new URL(expected);
  expectedRequest.hash = "";
  const response = await page.goto(expected.href);
  if (response) {
    expect(response.request().redirectedFrom(), pathname).toBeNull();
    expect(response.url(), pathname).toBe(expectedRequest.href);
    expect(new URL(response.url()).origin, pathname).toBe(publicOrigin);
  }
  expect(page.url(), pathname).toBe(expected.href);
}

test("public candidate exposes the exact release across key routes", async ({ page, request, context }) => {
  const rootResponse = await getExact(request, "/");
  expect(rootResponse.ok()).toBeTruthy();
  if (requiresPublicCandidate) {
    const rootHeaders = rootResponse.headers();
    expect(rootHeaders["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(rootHeaders["content-security-policy"]).not.toMatch(/127\.0\.0\.1:8788|localhost:8788/i);
    expect(rootHeaders["cache-control"]).toMatch(/no-cache/i);
  }

  await installPublicRequestBoundary(context);
  await gotoExact(page, "/");
  await page.getByRole("button", { name: /Explore pre-launch reference/i }).click();
  for (const [route, heading] of routes) {
    await gotoExact(page, `/#${route}`);
    await expect(page).toHaveTitle(`${heading} | Dusk Developer Studio`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  const manifestResponse = await getExact(request, "/release-manifest.json");
  const assuranceResponse = await getExact(request, "/assurance-receipt.json");
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
    const response = await getExact(request, `/${artifact.path}`);
    const body = await response.body();
    expect(response.ok(), artifact.path).toBeTruthy();
    expect(body.byteLength, artifact.path).toBe(artifact.bytes);
    expect(createHash("sha256").update(body).digest("hex"), artifact.path).toBe(artifact.sha256);
  }
});

test("public candidate exposes the complete DuskDS guide without DuskEVM RPC traffic", async ({ page, context }) => {
  const evmRpcRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === allowedRpcOrigin) evmRpcRequests.push(request.url());
  });

  await installPublicRequestBoundary(context);
  await gotoExact(page, "/");
  const duskDsPath = page.getByRole("button", { name: /Start DuskDS manually/i });
  const duskEvmPath = page.getByRole("button", { name: /Explore pre-launch reference/i });
  await expect(duskDsPath.getByText("Manual guide available", { exact: true })).toBeVisible();
  await expect(duskEvmPath.getByText("Reference only", { exact: true })).toBeVisible();
  await duskDsPath.click();

  const guide = page.getByLabel("DuskDS guide sequence");
  await expect(page.getByRole("heading", { name: "Record the native toolchain checks you ran." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run the required checks yourself" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save manual setup confirmation" })).toBeVisible();

  await guide.getByRole("button", { name: /2 Access/i }).click();
  await expect(page.getByRole("heading", { name: "Check a read-only Dusk node query." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read the public Testnet tip" })).toBeVisible();

  await guide.getByRole("button", { name: /3 Build/i }).click();
  await expect(page.getByRole("heading", { name: "Build contract and data-driver WASM together." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build contract + data-driver WASM" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create the reviewed starter" })).toBeVisible();

  await guide.getByRole("button", { name: /4 Inspect/i }).click();
  await expect(page.getByRole("heading", { name: "Confirm native state access and data-driver compatibility." })).toBeVisible();
  await expect(page.getByText(/\/on\/driver:<contract_id>\/get_schema/)).toBeVisible();
  await expect(page.getByText(/\/on\/driver:<contract_id>\/decode_output_fn:<fn_name>/)).toBeVisible();

  expect(evmRpcRequests, "DuskDS browsing must not contact the DuskEVM RPC").toEqual([]);
});

test("public candidate keeps the DuskEVM pre-launch reference inert while offline", async ({ page, context }) => {
  const evmRpcRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === allowedRpcOrigin) evmRpcRequests.push(request.url());
  });
  await installPublicRequestBoundary(context);
  await gotoExact(page, "/");
  await page.getByRole("button", { name: /Explore pre-launch reference/i }).click();
  await gotoExact(page, "/#setup");
  await expect(page.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel("Example identifier").fill(`0x${"b".repeat(40)}`);
  await expect(page.getByText("address", { exact: true })).toBeVisible();
  await expect(page.getByText("No live evidence is recorded")).toBeVisible();
  await expect(page.getByLabel("DuskEVM guide sequence")).toHaveCount(0);
  await expect(page.getByText(/forge create|cast wallet import/i)).toHaveCount(0);
  expect(evmRpcRequests, "The pre-launch reference must not contact the EVM RPC").toEqual([]);
  await context.setOffline(false);
});
