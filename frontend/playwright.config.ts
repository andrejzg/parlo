import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    cwd: __dirname,
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
