import { expect, test } from "@playwright/test";

/**
 * Smoke path for an ops persona. Requires Next + API with demo login enabled.
 */
test.describe("ops smoke", () => {
  test("operations side exposes inventory manager and lands on overview", async ({ page }) => {
    await page.goto("/login");
    const opsSide = page.getByRole("radio", { name: /operations/i }).first();
    if (!(await opsSide.isVisible().catch(() => false))) {
      test.skip(true, "Demo personas unavailable");
      return;
    }
    await opsSide.click();
    const inventory = page.getByRole("radio", { name: /inventory|ishita/i }).first();
    await expect(inventory).toBeVisible({ timeout: 10_000 });
    await inventory.click();
    await page.getByRole("button", { name: /continue as/i }).click();
    await page.waitForURL(/\/($|\?)/, { timeout: 20_000 }).catch(() => undefined);

    // Tour dialog may appear — skip it.
    const skip = page.getByRole("button", { name: /^skip$/i });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }

    await page.goto("/proposals");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

    const fab = page.getByTestId("chat-dock-fab");
    await expect(fab).toBeVisible({ timeout: 15_000 });
    await fab.click();
    await expect(page.getByRole("dialog", { name: /chat assistant/i })).toBeVisible();
  });
});
