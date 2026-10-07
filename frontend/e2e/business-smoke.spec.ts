import { expect, test } from "@playwright/test";

/**
 * Smoke path for a business persona. Requires:
 * - Frontend on PLAYWRIGHT_BASE_URL (default :3000)
 * - API reachable via /qc-api with demo login enabled
 * - QUICKCART_PUBLIC_DEMO unset (login required) OR demo picker visible
 */
test.describe("business experience smoke", () => {
  test("login page exposes demo personas", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Demo persona buttons or email field — either is enough for the smoke.
    const email = page.getByLabel(/email/i);
    const demo = page.getByRole("button", { name: /business|executive|store/i }).first();
    await expect(email.or(demo)).toBeVisible({ timeout: 15_000 });
  });

  test("business today is reachable after demo login when available", async ({ page }) => {
    await page.goto("/login");
    const demo = page.getByRole("button", { name: /executive|business exec/i }).first();
    if (await demo.isVisible().catch(() => false)) {
      await demo.click();
      await page.waitForURL(/\/(b\/today|b\/welcome|$)/, { timeout: 20_000 });
      if (page.url().includes("/b/welcome")) {
        // Skip onboarding for smoke: jump to today if the skip control exists.
        const later = page.getByRole("button", { name: /later|skip/i }).first();
        if (await later.isVisible().catch(() => false)) await later.click();
      }
      await page.goto("/b/today");
      await expect(page.getByRole("heading", { name: /today|good/i })).toBeVisible({
        timeout: 20_000,
      });
    } else {
      test.skip();
    }
  });

  test("voice dock is hidden or openable without crashing", async ({ page }) => {
    await page.goto("/b/ask");
    // Voice may be unavailable without GEMINI_API_KEY — either state is fine.
    const dock = page.getByRole("button", { name: /voice assistant/i });
    if (await dock.isVisible().catch(() => false)) {
      await dock.click();
      await expect(page.getByLabel(/captions|voice/i).first()).toBeVisible({ timeout: 10_000 });
    } else {
      // No dock when voice is off — page still renders Ask.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    }
  });
});
