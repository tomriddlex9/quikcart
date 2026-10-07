import { defineConfig, devices } from "@playwright/test";

/**
 * Optional local e2e. Install with:
 *   cd frontend && npm i -D @playwright/test && npx playwright install chromium
 * Run against a live stack (API :8000, Next :3000):
 *   npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
