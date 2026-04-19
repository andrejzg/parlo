import { test, chromium, devices, Route } from "@playwright/test";
import fs from "fs";
import { injectAudioMocks } from "./fixtures/mock-audio";

const BASE_URL = "http://localhost:5173";

/**
 * Visual check: the creator's question-review screen renders a media-type
 * badge (Voice / Photo / Video) next to each question. Stubs the backend
 * create + generate endpoints so we can drive the creator flow directly to
 * the review stage without needing Workers AI.
 */
test("creator sees media-type badges on review screen", async () => {
  test.setTimeout(90_000);
  const OUT = "/tmp/parlo-creator-badges";
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    permissions: ["microphone", "camera"],
  });
  const page = await context.newPage();

  // Minimal creator-side API mocks. We just need /surveys and /surveys/:id/generate.
  await page.route("**/api/surveys", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "creator-test-survey-id",
        code: "crtest",
        dashboardCode: "crtestdash",
        apiKey: "pk_test_key",
        uploadUrls: {
          audience: "https://fake-r2.example.com/upload/audience?token=a",
          gather: "https://fake-r2.example.com/upload/gather?token=g",
        },
      }),
    });
  });

  await page.route("https://fake-r2.example.com/**", async (route: Route) => {
    await route.fulfill({ status: 200, body: "" });
  });

  await page.route("**/api/surveys/*/generate", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: "Morning Routine Audit",
        questions: [
          { text: "Walk me through your morning routine", hint: "Question 1 of 3", type: "voice" },
          { text: "Show me your workspace right now", hint: "Question 2 of 3", type: "photo" },
          { text: "Give me a quick video demo of how you set up your desk", hint: "Question 3 of 3", type: "video" },
        ],
      }),
    });
  });

  await page.route("**/api/surveys/*/questions", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ questions: [] }),
    });
  });

  await injectAudioMocks(page);

  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/01-landing.png` });

  // Tap through Welcome → consent → audience question
  const startBtn = page.getByRole("button").first();
  if (await startBtn.count()) await startBtn.click();
  await page.waitForTimeout(800);

  // Accept consent screen
  const consentBtn = page.getByRole("button", { name: /I agree/i });
  await consentBtn.waitFor({ timeout: 5000 });
  await consentBtn.click();
  await page.waitForTimeout(1000);

  // Use Type instead for both creator setup questions (audience + gather)
  for (let i = 0; i < 2; i++) {
    const typeBtn = page.getByRole("button").filter({ hasText: /type instead|type/i }).first();
    if (await typeBtn.count()) {
      await typeBtn.click().catch(() => {});
      await page.waitForTimeout(400);
    }
    const ta = page.locator("textarea").first();
    if (await ta.count()) {
      await ta.fill(
        i === 0
          ? "Remote workers and creators"
          : "How they set up their desk for the day",
      );
      await page.waitForTimeout(300);
    }
    const next = page.getByRole("button").filter({ hasText: /^next$|^finish$/i }).first();
    if (await next.count()) {
      await next.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // Should now be on review screen with the 3 mocked questions.
  await page.getByText("Review your").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/02-review-with-badges.png`, fullPage: true });

  // Assert all three badge labels are visible.
  await page.getByText("Voice", { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText("Photo", { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText("Video", { exact: true }).first().waitFor({ timeout: 5000 });

  await context.close();
  await browser.close();
});
