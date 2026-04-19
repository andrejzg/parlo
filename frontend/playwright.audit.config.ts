import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "audit-iphone15pm.spec.ts",
  timeout: 180_000,
  reporter: "line",
  use: {
    baseURL: "https://parlo.me",
  },
  projects: [
    {
      name: "iphone15pm",
      use: { ...devices["iPhone 13 Pro Max"] },
    },
  ],
});
