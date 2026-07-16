import { expect, test } from "@playwright/test";

test("guided builder flow stays clear", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await expect(page.getByText("Choose your path")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick the execution model your app actually needs." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start Solidity path/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start native path/i })).toBeVisible();
  await expect(page.getByLabel("Builder path selector")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DuskEVM", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Start Solidity path/i }).click();
  await expect(page.getByRole("heading", { name: "Prove your RPC, wallet network, account, and balance read." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run RPC check" })).toBeVisible();

  const evmGuide = page.getByLabel("DuskEVM guide sequence");
  await evmGuide.getByRole("button", { name: /2 Access/i }).click();
  await expect(page.getByRole("heading", { name: "Confirm testnet DUSK is available for gas." })).toBeVisible();
  await expect(page.getByText("Check the selected Testnet balance")).toBeVisible();

  await evmGuide.getByRole("button", { name: /3 Build/i }).click();
  await expect(page.getByRole("heading", { name: "Create, build, and test the Counter starter." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Available in local Studio|Set up local companion|Create and verify Counter starter/i })).toBeVisible();

  await page.getByRole("button", { name: "Reference" }).click();
  await expect(page.getByRole("heading", { name: "Deeper context, with source receipts." })).toBeVisible();
  await expect(page.getByText("Open docs")).toBeVisible();

  await page.getByRole("button", { name: "Paths" }).click();
  await page.getByRole("button", { name: /Start native path/i }).click();
  await expect(page.getByRole("heading", { name: "Prove the native Dusk toolchain is ready." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Available in local Studio|Set up local companion|Run native preflight/i })).toBeVisible();

  const duskDsGuide = page.getByLabel("DuskDS guide sequence");
  await duskDsGuide.getByRole("button", { name: /2 Access/i }).click();
  await expect(page.getByRole("heading", { name: "Prove a read-only Dusk node query works." })).toBeVisible();
  await expect(page.getByText("Query the latest block with W3sper")).toBeVisible();

  await page.getByRole("button", { name: "Troubleshoot" }).click();
  await expect(page.getByRole("heading", { name: "Fix the blocker in front of you." })).toBeVisible();

  await page.getByRole("button", { name: /Local runtime/i }).click();
  await expect(page.getByRole("heading", { name: "Machine actions are unavailable in this build." })).toBeVisible();
  await expect(page.getByLabel("Pairing token")).toHaveCount(0);
  await expect(page.getByText("there is no manual token-copy workflow", { exact: false })).toBeVisible();
});
