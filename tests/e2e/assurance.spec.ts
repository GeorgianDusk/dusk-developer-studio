import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  ["overview", "Pick the execution model your app actually needs."],
  ["setup", "Explore the planned DuskEVM developer workflow."],
  ["access", "Explore the planned DuskEVM developer workflow."],
  ["build", "Explore the planned DuskEVM developer workflow."],
  ["inspect", "Explore the planned DuskEVM developer workflow."],
  ["reference", "Source-backed context for the task in front of you."],
  ["troubleshooting", "Review DuskEVM launch-planning issues."],
  ["companion", "Run the full Studio locally with npm."],
  ["settings", "See the build you are using and control its saved progress."]
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("every deep link renders a stable route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open pre-launch overview/i }).click();
  for (const [route, heading] of routes) {
    await page.goto(`/#${route}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main.studio-main")).toBeVisible();
  }
});

test("a pathless guide deep link preserves the requested step until path choice", async ({ page }) => {
  await page.goto("/#build");
  await expect(page).toHaveURL(/#build$/);
  await expect(page.getByRole("heading", { name: "Choose a path to continue to Build." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open pre-launch overview/i })).toHaveAccessibleName("DuskEVM. Open pre-launch overview");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await expect(page).toHaveURL(/#duskds\/build$/);
  await expect(page.getByRole("heading", { name: "Build contract and data-driver WASM together." })).toBeVisible();
});

test("keyboard and reduced-motion modes preserve the primary flow", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  if (testInfo.project.name.includes("webkit") || testInfo.project.name.includes("safari")) {
    // Safari's default macOS preference omits links from Tab order. Focus still
    // proves the bypass control can receive focus and activate in this engine.
    await skipLink.focus();
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#studio-main")).toBeFocused();
  const homeButton = page.getByRole("button", { name: "Dusk Developer Studio home", exact: true });
  const compactPathsButton = page.getByRole("button", { name: "Paths", exact: true });
  const visibleHomeControl = await homeButton.isVisible() ? homeButton : compactPathsButton;
  const duskDsPath = page.getByRole("button", { name: /Start DuskDS/i });
  await visibleHomeControl.focus();
  await expect(visibleHomeControl).toBeFocused();
  await duskDsPath.focus();
  await expect(duskDsPath).toBeFocused();
  await expect(duskDsPath).not.toHaveAttribute("aria-pressed");
  const duration = await duskDsPath.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#duskds\/setup$/);
  const setupHeading = page.getByRole("heading", { name: "Record the native toolchain checks you ran." });
  await expect(setupHeading).toBeFocused();
  await expect(page).toHaveTitle(/Record the native toolchain checks you ran\. \| Dusk Developer Studio/);
  const nextStep = page.getByRole("button", { name: "Next: Access" });
  await nextStep.focus();
  await page.keyboard.press("Enter");
  const accessHeading = page.getByRole("heading", { name: "Check a read-only Dusk node query." });
  await expect(accessHeading).toBeFocused();
});

test("documented responsive boundaries reflow without page overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "One deterministic reflow pass covers the shared responsive layout.");
  await page.goto("/");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  for (const viewport of [
    { width: 320, height: 800, route: "overview" },
    { width: 320, height: 800, route: "setup" },
    { width: 320, height: 800, route: "inspect" },
    { width: 390, height: 844, route: "setup" },
    { width: 390, height: 844, route: "inspect" },
    { width: 760, height: 1000, route: "setup" },
    { width: 760, height: 1000, route: "inspect" },
    { width: 761, height: 1000, route: "setup" },
    { width: 761, height: 1000, route: "inspect" },
    { width: 1120, height: 900, route: "setup" },
    { width: 1120, height: 900, route: "inspect" },
    { width: 1121, height: 900, route: "setup" },
    { width: 1121, height: 900, route: "inspect" },
    { width: 1280, height: 900, route: "overview" },
    { width: 1280, height: 900, route: "inspect" },
    { width: 1440, height: 1000, route: "overview" },
    { width: 1440, height: 1000, route: "inspect" }
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/#${viewport.route}`);
    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clippedTextElements: Array.from(document.querySelectorAll<HTMLElement>("main p, main h1, main h2, main h3, main strong, main em"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && element.scrollWidth > element.clientWidth + 1;
        })
        .map((element) => ({
          selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().replace(/\s+/g, ".")}` : ""}`,
          text: element.textContent?.trim().slice(0, 120),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        })),
      overflowingElements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.trim().replace(/\s+/g, ".")}` : ""}`,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth
          };
        })
        .filter((element) => element.left < -1 || element.right > window.innerWidth + 1 || element.scrollWidth > element.clientWidth + 1)
        .slice(0, 20),
      smallTargetCount: Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && (rect.width < 40 || rect.height < 40);
        }).length
    }));
    expect(layout.scrollWidth, JSON.stringify(layout.overflowingElements, null, 2)).toBeLessThanOrEqual(layout.innerWidth);
    expect(
      layout.clippedTextElements,
      `${viewport.width}x${viewport.height} #${viewport.route}\n${JSON.stringify(layout.clippedTextElements, null, 2)}`
    ).toEqual([]);
    expect(layout.smallTargetCount).toBe(0);
    if (viewport.route === "inspect" && viewport.width <= 390) {
      const contractBox = await page.getByLabel("Deployed contract ID").boundingBox();
      const functionBox = await page.getByLabel("Function name for encode / decode").boundingBox();
      expect(contractBox).not.toBeNull();
      expect(functionBox).not.toBeNull();
      expect(Math.abs((contractBox?.x ?? 0) - (functionBox?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(functionBox?.y ?? 0).toBeGreaterThan((contractBox?.y ?? 0) + (contractBox?.height ?? 0));
    }
  }
});

test("mobile long-page navigation and Reference disclosure controls stay reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "One deterministic mobile interaction pass covers the shared responsive layout.");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await page.getByRole("navigation", { name: "Studio navigation" }).getByRole("button", { name: "Reference" }).click();
  await page.getByRole("button", { name: "All references" }).click();

  const expandDocs = page.getByRole("button", { name: /Show all \d+ docs/i });
  await expandDocs.scrollIntoViewIfNeeded();
  const before = await expandDocs.boundingBox();
  await expandDocs.click();
  const collapseDocs = page.getByRole("button", { name: "Show fewer docs" });
  await expect(collapseDocs).toBeInViewport();
  const after = await collapseDocs.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(2);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole("navigation", { name: "Studio navigation" })).toBeInViewport();
  await expect(page.getByRole("button", { name: /Return to DuskDS at/i })).toBeInViewport();

  await page.getByRole("button", { name: "Troubleshoot" }).click();
  await page.getByRole("textbox", { name: "Search" }).fill("Rust 1.94.0");
  await expect(page.getByText("Recheck:", { exact: true }).first()).toBeVisible();
});

test("offline hosted DuskDS node failure stays controlled and retryable", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.goto("/#access");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Run hosted safe check" }).click();
  await expect(page.getByRole("alert")).toContainText(/could not be reached|did not answer/i);
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
  await page.goto("/");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  for (const route of ["overview", "setup", "inspect", "reference"] as const) {
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
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => (window as unknown as { __studioMetrics: { lcp: number; cls: number; interaction: number } }).__studioMetrics);
  expect(metrics.lcp).toBeGreaterThan(0);
  expect(metrics.lcp).toBeLessThanOrEqual(2_500);
  expect(metrics.cls).toBeLessThanOrEqual(0.1);
  expect(metrics.interaction).toBeLessThanOrEqual(200);
});
