import { defineConfig, devices } from "@playwright/test";

import { resolveE2eEnvironment } from "./e2e/support/environment";

const environment = resolveE2eEnvironment();

process.env.NEXT_PUBLIC_SUPABASE_URL = environment.supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = environment.anonKey;
process.env.PLAYHOUSE_E2E_SUPABASE_URL = environment.supabaseUrl;
process.env.PLAYHOUSE_E2E_SUPABASE_ANON_KEY = environment.anonKey;
process.env.PLAYHOUSE_E2E_SUPABASE_SERVICE_ROLE_KEY = environment.serviceRoleKey;

const webServerEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  ),
);
webServerEnvironment.PLAYHOUSE_E2E_SUPABASE_SERVICE_ROLE_KEY = "";
webServerEnvironment.PLAYHOUSE_E2E_PEOPLE_ADAPTER = "deterministic";

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results/e2e",
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3002",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: webServerEnvironment,
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://localhost:3002",
  },
  workers: 1,
});
