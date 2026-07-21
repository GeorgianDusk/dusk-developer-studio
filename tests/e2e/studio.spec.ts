import { expect, test } from "@playwright/test";

test("guided builder flow stays clear", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await expect(page.getByText("Choose your path")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open pre-launch overview/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start DuskDS/i })).toBeVisible();
  await expect(page.getByLabel("Builder path selector")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DuskEVM", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Open pre-launch overview/i }).click();
  await expect(page.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeVisible();
  await page.getByLabel("Example identifier").fill(`0x${"b".repeat(40)}`);
  await expect(page.getByText("address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Resume DuskEVM/i })).toHaveCount(0);
  await expect(page.getByText(/0\/4/)).toHaveCount(0);

  await page.getByRole("button", { name: "Paths" }).click();
  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await expect(page.getByRole("heading", { name: "Record the native toolchain checks you ran." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run the required checks yourself" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save manual setup confirmation" })).toBeVisible();

  const duskDsGuide = page.getByLabel("DuskDS guide sequence");
  await duskDsGuide.getByRole("button", { name: /2 Access/i }).click();
  await expect(page.getByRole("heading", { name: "Check a read-only Dusk node query." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read the public Testnet tip" })).toBeVisible();

  await page.getByRole("button", { name: "Troubleshoot" }).click();
  await expect(page.getByRole("heading", { name: "Fix the blocker in front of you." })).toBeVisible();

  await page.getByRole("button", { name: /Local Studio/i }).click();
  await expect(page.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeVisible();
  await expect(page.getByLabel("Pairing token")).toHaveCount(0);
  const returnToJourney = page.getByRole("button", { name: "Return to DuskDS at Access" });
  await expect(returnToJourney).toBeVisible();
  await returnToJourney.click();
  await expect(page.getByRole("heading", { name: "Check a read-only Dusk node query." })).toBeVisible();
});

test("internal navigation preserves browser back and forward history", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await expect(page).toHaveURL(/#reference$/u);
  await expect(page.getByRole("heading", { name: "Source-backed context for the task in front of you." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open the official docs source/ })).toHaveAttribute(
    "href",
    "https://github.com/dusk-network/docs"
  );

  await page.goBack();
  await expect(page).not.toHaveURL(/#reference$/u);
  await expect(page.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/#reference$/u);
  await expect(page.getByRole("heading", { name: "Source-backed context for the task in front of you." })).toBeVisible();
});

test("browser history restores the document title and prior scroll position", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto("/");

  const overviewHeading = page.getByRole("heading", { name: "Pick the execution model your app actually needs." });
  await expect(overviewHeading).toBeVisible();
  const overviewTitle = await page.title();

  await page.getByRole("button", { name: /Open pre-launch overview/i }).click();
  await expect(page.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." })).toBeVisible();
  await expect(page).not.toHaveTitle(overviewTitle);
  await page.goBack();
  await expect(overviewHeading).toBeVisible();
  await expect(page).toHaveTitle(overviewTitle);

  await page.evaluate(() => window.scrollTo(0, 1_100));
  const overviewScrollY = await page.evaluate(() => window.scrollY);
  expect(overviewScrollY).toBeGreaterThan(500);
  await expect.poll(() => page.evaluate(() => window.history.state?.duskStudioScrollY)).toBe(overviewScrollY);
  const referenceButton = page.getByRole("button", { name: "Reference", exact: true });
  await referenceButton.click();
  const referenceHeading = page.getByRole("heading", { name: "Source-backed context for the task in front of you." });
  await expect(referenceHeading).toBeVisible();
  await expect(referenceHeading).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, 1_100));
  const referenceScrollY = await page.evaluate(() => window.scrollY);
  expect(referenceScrollY).toBeGreaterThan(500);
  await expect.poll(() => page.evaluate(() => window.history.state?.duskStudioScrollY)).toBe(referenceScrollY);
  const expectedForwardFocusPath = await page.evaluate(() => {
    const root = document.getElementById("studio-main");
    if (!root) return null;
    const selector = "a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex='-1'])";
    const target = Array.from(root.querySelectorAll<HTMLElement>(selector)).find((candidate) => {
      const style = window.getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
        && rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    if (!target) return null;
    const path: number[] = [];
    let current: Element | null = target;
    while (current && current !== root) {
      const parent: Element | null = current.parentElement;
      if (!parent) return null;
      path.unshift(Array.from(parent.children).indexOf(current));
      current = parent;
    }
    return path;
  });
  expect(expectedForwardFocusPath).not.toBeNull();

  await page.goBack();
  await expect(overviewHeading).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(overviewScrollY);
  await expect(referenceButton).toBeFocused();
  await expect(referenceButton).toBeInViewport();

  await page.goForward();
  await expect(referenceHeading).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(referenceScrollY);
  const restoredForwardFocusPath = await page.evaluate(() => {
    const root = document.getElementById("studio-main");
    const element = document.activeElement;
    if (!root || !(element instanceof HTMLElement) || !root.contains(element)) return null;
    const path: number[] = [];
    let current: Element | null = element;
    while (current && current !== root) {
      const parent: Element | null = current.parentElement;
      if (!parent) return null;
      path.unshift(Array.from(parent.children).indexOf(current));
      current = parent;
    }
    return path;
  });
  expect(restoredForwardFocusPath).toEqual(expectedForwardFocusPath);
  await expect(referenceHeading).not.toBeFocused();
});

test("browser history restores the builder path associated with each entry", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await page.getByRole("button", { name: /Open pre-launch overview/i }).click();
  const evmHeading = page.getByRole("heading", { name: "Explore the planned DuskEVM developer workflow." });
  await expect(evmHeading).toBeVisible();
  await page.getByRole("button", { name: "Paths" }).click();
  await expect(page.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeVisible();

  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await expect(page.getByRole("heading", { name: "Record the native toolchain checks you ran." })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeVisible();
  await page.goBack();
  await expect(evmHeading).toBeVisible();
});

test("revealed tool-help links have descriptive accessible names", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();

  const gitRow = page.locator("article.manual-tool-row").filter({ has: page.getByText("Git", { exact: true }) });
  await expect(gitRow.getByRole("link", { name: /Git installation and help/ })).toBeHidden();
  await gitRow.getByText("Commands and expected result").click();
  const helpLink = gitRow.getByRole("link", { name: /Git installation and help/ });
  await expect(helpLink).toBeVisible();
  await expect(helpLink).toHaveAttribute("href", "https://git-scm.com/downloads");
  await helpLink.focus();
  await expect(helpLink).toBeFocused();
});

test("Troubleshooting no-result recovery returns focus to search", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await page.getByRole("button", { name: "Troubleshoot" }).click();
  const search = page.getByPlaceholder(/Search Forge, Rust, WASM/i);
  await search.fill("zzzz-no-such-fix");
  await expect(page.getByText("0 recovery entries found.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open project support/ })).toHaveAttribute(
    "href",
    "https://github.com/GeorgianDusk/dusk-developer-studio/issues"
  );

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(page.getByText(/recovery entries found\./)).toBeVisible();
});

test("invalid Build evidence identifies, describes, and focuses the recovery field", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: /Start DuskDS/i }).click();

  const setupChecks = page.getByRole("button", { name: /^Mark .* as checked$/u });
  await expect(setupChecks).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await setupChecks.first().click();
  await page.getByRole("button", { name: "Save manual setup confirmation" }).click();

  const guide = page.getByLabel("DuskDS guide sequence");
  await guide.getByRole("button", { name: /2 Access/i }).click();
  await page.getByRole("button", { name: /Manual now/ }).click();
  await page.getByRole("button", { name: "Mark Deno as checked" }).click();
  await page.getByLabel("Block height").fill("1");
  await page.getByLabel("Block hash").fill("a".repeat(64));
  await page.getByRole("button", { name: "Save manual node observation" }).click();

  await guide.getByRole("button", { name: /3 Build/i }).click();
  await page.getByRole("button", { name: "Linux shell" }).click();
  await page.getByRole("button", { name: "Cargo.toml is present" }).click();
  await page.getByRole("button", { name: /rust-toolchain\.toml pins/ }).click();
  await page.getByLabel("Source identity", { exact: true }).fill("b".repeat(40));
  await page.getByRole("button", { name: "Save manual structure confirmation" }).click();
  await page.getByRole("button", { name: "Save manual artifact evidence" }).click();

  const contractFilename = page.getByLabel("Filename").first();
  await expect(contractFilename).toHaveAttribute("aria-invalid", "true");
  await expect(contractFilename).toHaveAttribute("aria-describedby", "duskds-build-artifact-error");
  await expect(contractFilename).toBeFocused();
  await expect(page.locator("#duskds-build-artifact-error")).toContainText("WASM basename");
});

test("keyboard order, focus treatment, and Local Studio targets follow the accessibility contract", async ({ page, browserName }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: /Start DuskDS/i }).click();
  await page.getByRole("button", { name: "Troubleshoot" }).click();

  const routeHeading = page.getByRole("heading", { name: "Fix the blocker in front of you." });
  const brand = page.getByRole("button", { name: "Dusk Developer Studio home" });
  const topNavigation = page.getByRole("navigation", { name: "Studio navigation" });
  const journeyContext = page.getByRole("button", { name: "Return to DuskDS at Setup" });
  const brandBox = await brand.boundingBox();
  let navigationBox = await topNavigation.boundingBox();
  let contextBox = await journeyContext.boundingBox();

  expect(brandBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(contextBox).not.toBeNull();
  expect(Math.abs(brandBox!.y - navigationBox!.y)).toBeLessThan(8);
  expect(navigationBox!.y).toBeLessThan(contextBox!.y);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(brand).toBeHidden();
  navigationBox = await topNavigation.boundingBox();
  contextBox = await journeyContext.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(contextBox).not.toBeNull();
  expect(navigationBox!.y).toBeLessThan(contextBox!.y);

  await expect(routeHeading).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(journeyContext).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const localStudioButton = page.getByRole("button", { name: /Local Studio/i });
  await expect(localStudioButton).toBeFocused();

  await localStudioButton.click();
  await expect(page.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeFocused();

  const commandTargets = [
    page.getByRole("button", { name: "Copy Safe mode" }),
    page.getByRole("button", { name: "Copy Local Actions" })
  ];
  const linkTargets = [
    page.getByRole("link", { name: /Get Node.js/i }),
    page.getByRole("link", { name: /Review this package version and provenance/i }),
    page.getByRole("link", { name: "Continue in the hosted guide" })
  ];
  const storageDisclosure = page.locator("summary", { hasText: "Where created projects are stored" });
  const keyboardSequence = [
    ...commandTargets,
    // WebKit follows Safari's default keyboard preference and skips links unless
    // Full Keyboard Access is enabled at the OS/browser level. Its Linux CI build
    // also skips native summary controls under that preference.
    ...(browserName === "webkit" ? [] : [...linkTargets, storageDisclosure])
  ];
  for (const target of keyboardSequence) {
    await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
  }

  if (browserName === "webkit") await storageDisclosure.focus();
  await expect(storageDisclosure).toBeFocused();
  await expect(storageDisclosure).toHaveCSS("display", "list-item");
  await expect(storageDisclosure).toHaveCSS("outline-style", "solid");
  await expect(storageDisclosure).toHaveCSS("outline-width", "2px");
  await expect(storageDisclosure).toHaveCSS("outline-offset", "2px");
  await page.keyboard.press("Enter");
  await expect(page.locator("details.local-storage-disclosure")).toHaveAttribute("open", "");

  const companionTargets = page.locator(".reference-page :is(a, button, summary)");
  const targetCount = await companionTargets.count();
  expect(targetCount).toBeGreaterThan(0);
  for (let index = 0; index < targetCount; index += 1) {
    const target = companionTargets.nth(index);
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box, `Local Studio target ${index + 1} should have a rendered box`).not.toBeNull();
    expect(box!.height, `Local Studio target ${index + 1} should be at least 44px tall`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `Local Studio target ${index + 1} should be at least 44px wide`).toBeGreaterThanOrEqual(44);
  }
});
