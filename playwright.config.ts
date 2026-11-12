import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build in local mode (embedded
 * database, demo content). An in-memory database is used, so every run starts fresh.
 */
const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { LOCAL_DB_DIR: "memory://", LOCAL_ADMIN_PASSWORD: "e2e-admin-password", PLAYWRIGHT: "1", NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}` },
  },
});
