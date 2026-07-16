import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("every deep link renders a stable route", async ({ page }) => {
  for (const [route, heading] of routes) {
    await page.goto(`/#${route}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main.studio-main")).toBeVisible();
  }
});

test("keyboard and reduced-motion modes preserve the primary flow", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const homeButton = page.getByRole("button", { name: "Dusk Developer Studio home", exact: true });
  const duskEvmPath = page.getByRole("button", { name: /Start Solidity path/i });
  await homeButton.focus();
  await expect(homeButton).toBeFocused();
  await duskEvmPath.focus();
  await expect(duskEvmPath).toBeFocused();
  await expect(duskEvmPath).not.toHaveAttribute("aria-pressed");
  const duration = await duskEvmPath.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#setup$/);
  await expect(page.getByRole("heading", { name: "Prove your RPC, wallet network, account, and balance read." })).toBeVisible();
});

test("narrow and zoom-equivalent layouts reflow without page overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "One deterministic reflow pass covers the shared responsive layout.");
  for (const viewport of [
    { width: 320, height: 800, route: "overview" },
    { width: 640, height: 900, route: "setup" }
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/#${viewport.route}`);
    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clippedTextCount: Array.from(document.querySelectorAll("main p, main h1, main h2, main h3, main strong, main em"))
        .filter((element) => element.scrollWidth > element.clientWidth + 1).length
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.clippedTextCount).toBe(0);
  }
});

test("offline RPC failure stays controlled and retryable", async ({ page, context }) => {
  await page.goto("/#setup");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Run RPC check" }).click();
  await expect(page.getByRole("alert")).toContainText(/browser could not reach|RPC request failed|timed out/i);
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await context.setOffline(false);
});

test("built release exposes matching release and assurance receipts", async ({ request }) => {
  const manifestResponse = await request.get("/release-manifest.json");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ schema_version: 2, product: "Dusk Developer Studio", environment: "local-preview" });
  expect(manifest.artifacts.some((artifact: { path?: string }) => artifact.path === "assurance-receipt.json")).toBeTruthy();
  const assuranceResponse = await request.get("/assurance-receipt.json");
  expect(assuranceResponse.ok()).toBeTruthy();
  const assurance = await assuranceResponse.json();
  expect(assurance).toMatchObject({ schema_version: 1, assets: { status: "passed" }, deployment_headers: { status: "passed" }, source_links_and_schema: { status: "passed" } });
});

test("critical routes have no automated WCAG A/AA violations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "One deterministic axe pass covers shared markup; browser projects cover rendering parity.");
  for (const route of ["overview", "setup", "reference"] as const) {
    await page.goto(`/#${route}`);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }
});

test("Chromium lab metrics stay inside the enforced policy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Performance budgets are calibrated for the Chromium lab project.");
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0, interaction: 0 };
    Object.defineProperty(window, "__studioMetrics", { value: metrics, configurable: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) metrics.lcp = Math.max(metrics.lcp, entry.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) if (!entry.hadRecentInput) metrics.cls += entry.value ?? 0; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) metrics.interaction = Math.max(metrics.interaction, entry.duration); }).observe({ type: "event", buffered: true });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Solidity path/i }).click();
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => (window as unknown as { __studioMetrics: { lcp: number; cls: number; interaction: number } }).__studioMetrics);
  expect(metrics.lcp).toBeGreaterThan(0);
  expect(metrics.lcp).toBeLessThanOrEqual(2_500);
  expect(metrics.cls).toBeLessThanOrEqual(0.1);
  expect(metrics.interaction).toBeLessThanOrEqual(200);
});
