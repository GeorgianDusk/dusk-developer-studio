import { expect, test } from "@playwright/test";

test("guided builder flow stays clear", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await expect(page.getByText("Choose your path")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Explore pre-launch reference/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start DuskDS/i })).toBeVisible();
  await expect(page.getByLabel("Builder path selector")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DuskEVM", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Explore pre-launch reference/i }).click();
  await expect(page.getByRole("heading", { name: "Source-backed context for the task in front of you." })).toBeVisible();
  await expect(page.getByRole("button", { name: "DuskEVM only" })).toHaveAttribute("aria-pressed", "true");
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

  await page.getByRole("button", { name: /Automation/i }).click();
  await expect(page.getByRole("heading", { name: "Run the full Studio locally with npm." })).toBeVisible();
  await expect(page.getByLabel("Pairing token")).toHaveCount(0);
  const returnToJourney = page.getByRole("button", { name: "Return to DuskDS at Access" });
  await expect(returnToJourney).toBeVisible();
  await returnToJourney.click();
  await expect(page.getByRole("heading", { name: "Check a read-only Dusk node query." })).toBeVisible();
});
