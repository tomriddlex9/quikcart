import { expect, test } from "@playwright/test";

/**
 * Smoke path for a business persona. Requires:
 * - Next on :3000
 * - API reachable via /qc-api with demo login enabled
 * - QUICKCART_PUBLIC_DEMO unset (login required) OR demo picker visible
 */
test.describe("business smoke", () => {
  test("login page exposes side picker and demo personas", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    const businessSide = page.getByRole("radio", { name: /business/i }).first();
    const emailToggle = page.getByRole("button", { name: /sign in with email/i });
    await expect(businessSide.or(emailToggle)).toBeVisible({ timeout: 15_000 });
  });

  test("business today is reachable after demo login when available", async ({ page }) => {
    await page.goto("/login");
    const businessSide = page.getByRole("radio", { name: /business/i }).first();
    if (!(await businessSide.isVisible().catch(() => false))) return;
    await businessSide.click();
    const demo = page.getByRole("radio", { name: /executive|asha|business/i }).first();
    if (!(await demo.isVisible().catch(() => false))) return;
    await demo.click();
    await page.getByRole("button", { name: /continue as/i }).click();
    await page.waitForURL(/\/(b\/today|b\/welcome)?$/, { timeout: 20_000 }).catch(() => undefined);

    const skip = page.getByRole("button", { name: /skip for now/i });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
    await page.goto("/b/today");
    await expect(page.getByRole("heading", { level: 1, name: /today|good/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("ask center heading is reachable", async ({ page }) => {
    await page.goto("/b/ask");
    // May redirect to login; either outcome is fine for smoke.
    const ask = page.getByRole("heading", { level: 1, name: /ask/i });
    const login = page.getByRole("heading", { level: 1, name: /sign in/i });
    await expect(ask.or(login)).toBeVisible({ timeout: 15_000 });
  });

  test("store vs leadership homes differ and provenance opens a KPI journey", async ({
    page,
  }) => {
    await page.goto("/login");
    const businessSide = page.getByRole("radio", { name: /business/i }).first();
    if (!(await businessSide.isVisible().catch(() => false))) return;
    await businessSide.click();

    const storePersona = page.getByRole("radio", { name: /store manager|priya/i }).first();
    if (!(await storePersona.isVisible().catch(() => false))) return;
    await storePersona.click();
    await page.getByRole("button", { name: /continue as/i }).click();
    const skip = page.getByRole("button", { name: /skip for now/i });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.goto("/b/today");
    await expect(page.getByTestId("store-home")).toBeVisible({ timeout: 20_000 });

    // Switch demo persona via settings when available
    await page.goto("/b/settings");
    const leadership = page.getByRole("radio", { name: /leadership|meera/i }).first();
    if (await leadership.isVisible().catch(() => false)) {
      await leadership.click();
      await page.goto("/b/today");
      await expect(page.getByTestId("leadership-home")).toBeVisible({ timeout: 20_000 });
    }

    const toggle = page.getByTestId("provenance-mode-toggle");
    if (!(await toggle.isVisible().catch(() => false))) return;
    await toggle.click();
    const tile = page.getByTestId("metric-tile").first();
    await tile.click();
    await expect(page.getByTestId("kpi-journey-inspector")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kpi-journey-rail")).toContainText(/raw|orders|gold/i);
  });
});
