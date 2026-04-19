import { test, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { injectAudioMocks } from "./fixtures/mock-audio";
import { setupApiMocks, TEST_SURVEY, TEST_RESPONSE } from "./fixtures/mock-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "http://localhost:5173";
const SURVEY_CODE = "audit123";

// Tiny real media files for setInputFiles — 540x960 vertical JPEG + MP4
// generated via ffmpeg. PhotoQuestionScreen runs browser-image-compression
// over the JPEG; VideoQuestionScreen probes dimensions + duration via a
// <video> element. Both need real, valid bytes to clear the validation path.
const PHOTO_FIXTURE = path.join(__dirname, "fixtures/media/test-photo.jpg");
const VIDEO_FIXTURE = path.join(__dirname, "fixtures/media/test-video.mp4");

const DEVICES = [
  { name: "iphone-se", profile: devices["iPhone SE"] },
  { name: "pixel-7", profile: devices["Pixel 7"] },
  { name: "iphone-15-pro-max", profile: devices["iPhone 15 Pro Max"] },
];

// Mixed-type survey templates — one per question type for easy pass-2 capture.
function makeMixedSurvey(code: string, questionType: "photo" | "video") {
  return {
    id: `audit-${questionType}-id`,
    title: `${questionType === "photo" ? "Photo" : "Video"} Audit`,
    status: "active",
    questions: [
      {
        id: `qaudit-${questionType}-uuid`,
        survey_id: `audit-${questionType}-id`,
        sort_order: 0,
        text:
          questionType === "photo"
            ? "Show me your workspace right now"
            : "Give me a quick video demo of your morning",
        hint: questionType === "photo" ? "Just a quick photo" : "Keep it under 60 seconds",
        question_type: questionType,
      },
    ],
    audioKeys: [],
  };
}

function makeMixedResponse(questionType: "photo" | "video") {
  return {
    id: `audit-${questionType}-response`,
    code: `audit${questionType}`,
    uploadUrls: {
      [`qaudit-${questionType}-uuid`]: `https://fake-r2.example.com/upload/${questionType}?token=abc`,
    },
  };
}

async function setupMixedMocks(page: Page, questionType: "photo" | "video") {
  const code = `audit${questionType}`;
  const survey = makeMixedSurvey(code, questionType);
  const response = makeMixedResponse(questionType);

  await page.route(`**/api/s/${code}`, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(survey),
    });
  });
  await page.route(`**/api/s/${code}/responses`, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.route(`**/api/geo`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ country: "US" }),
    });
  });
}

for (const { name, profile } of DEVICES) {
  test(`audit ${name}`, async () => {
    test.setTimeout(120_000);

    const OUT = `/tmp/parlo-${name}`;
    fs.mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch();
    const context = await browser.newContext({
      ...profile,
      permissions: ["microphone", "camera"],
    });

    const shot = async (page: Page, label: string) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: false });
      console.log(`[${name}] ${label}`);
    };

    try {
      // ============ Pass 1: voice-only happy path (welcome → phone) ============
      const page = await context.newPage();
      await injectAudioMocks(page);
      await setupApiMocks(page, { surveyCode: SURVEY_CODE });

      await page.goto(`${BASE_URL}/s/${SURVEY_CODE}`);
      await page.waitForLoadState("networkidle");

      await page.getByText(TEST_SURVEY.title).waitFor({ timeout: 10000 });
      await shot(page, "01-welcome");

      await page.getByRole("button", { name: "Start recording" }).click();
      await page.getByText("Before you start").waitFor();
      await shot(page, "02-consent");

      await page.getByRole("button", { name: "I agree, start recording" }).click();
      await page.getByText("1 / 3").waitFor();
      await page.waitForTimeout(1000);
      await shot(page, "03-question-voice");

      // Walk through Q1-Q3
      for (let i = 1; i <= 3; i++) {
        await page.getByText(`${i} / 3`).waitFor();
        await page.waitForTimeout(600);
        await page.getByRole("button", { name: "Next" }).first().click();
      }

      await page.getByText("Review your answers").waitFor({ timeout: 10000 });
      await shot(page, "04-review");

      await page.getByRole("button", { name: "Looks good, continue" }).click();
      await page.getByText("What's your phone number?").waitFor({ timeout: 10000 });
      await shot(page, "05-phone");

      await page.close();

      // ============ Pass 2a: mixed survey with PHOTO as Q1 ============
      const page2 = await context.newPage();
      await injectAudioMocks(page2);
      await setupMixedMocks(page2, "photo");

      await page2.goto(`${BASE_URL}/s/auditphoto`);
      await page2.waitForLoadState("networkidle");

      await page2.getByText("Photo Audit").waitFor({ timeout: 10000 });
      await shot(page2, "06a-welcome-photo");
      await page2.getByRole("button", { name: /let.?s start|start/i }).first().click();
      await page2.getByText("Before you start").waitFor();
      await shot(page2, "06b-consent-photo");
      await page2.getByRole("button", { name: /agree/i }).first().click();

      await page2.getByText("1 / 1").waitFor({ timeout: 10000 });
      await page2.waitForTimeout(800);
      await shot(page2, "06c-photo-capture");

      // Inject the fixture photo via the hidden file input. The capture
      // button's `<input type="file" capture="environment">` accepts files
      // programmatically too — browser-image-compression will process the
      // real JPEG bytes and the preview will render with Retake + Done.
      await page2.locator('input[type="file"]').first().setInputFiles(PHOTO_FIXTURE);
      // Wait for the Retake button to appear — its presence is the signal
      // that the preview state is fully rendered.
      await page2.getByRole("button", { name: /retake/i }).waitFor({ timeout: 15000 });
      await page2.waitForTimeout(400);
      await shot(page2, "06d-photo-preview");

      await page2.close();

      // ============ Pass 2b: mixed survey with VIDEO as Q1 ============
      const page3 = await context.newPage();
      await injectAudioMocks(page3);
      await setupMixedMocks(page3, "video");

      await page3.goto(`${BASE_URL}/s/auditvideo`);
      await page3.waitForLoadState("networkidle");

      await page3.getByText("Video Audit").waitFor({ timeout: 10000 });
      await shot(page3, "07a-welcome-video");
      await page3.getByRole("button", { name: /let.?s start|start/i }).first().click();
      await page3.getByText("Before you start").waitFor();
      await shot(page3, "07b-consent-video");
      await page3.getByRole("button", { name: /agree/i }).first().click();

      await page3.getByText("1 / 1").waitFor({ timeout: 10000 });
      await page3.waitForTimeout(800);
      await shot(page3, "07c-video-capture");

      // Inject the fixture video. VideoQuestionScreen will probe duration +
      // dimensions via a hidden <video> element — the fixture is 540x960
      // vertical, 2 seconds, H.264, which passes all validation checks.
      await page3.locator('input[type="file"]').first().setInputFiles(VIDEO_FIXTURE);
      await page3.getByRole("button", { name: /retake/i }).waitFor({ timeout: 15000 });
      await page3.waitForTimeout(400);
      await shot(page3, "07d-video-preview");

      await page3.close();

      // ============ Pass 3: voice survey → all the way to Thank You ============
      // Pre-seed `parlo-device-auth` localStorage so the flow skips phone+OTP
      // entirely (the "returning participant" code path) and lands on submit →
      // done. This is how we screenshot Thank You without wrestling with
      // Firebase reCAPTCHA in headless Chromium.
      //
      // IMPORTANT: use a brand new context. Passes 1-2 share storage
      // (localStorage + IndexedDB) via the original `context`, and pass 1
      // stops at the phone screen — that stage gets persisted to IndexedDB
      // by `sessionStore`. If we reused the same context, session restore
      // would drop pass 3 back at the phone screen instead of the welcome.
      const ctx3 = await browser.newContext({
        ...profile,
        permissions: ["microphone", "camera"],
      });
      const page4 = await ctx3.newPage();
      await page4.addInitScript(() => {
        try {
          localStorage.setItem(
            "parlo-device-auth",
            JSON.stringify({
              id: "parlo-device",
              phone: "+12345678901",
              verifiedAt: Date.now(),
            }),
          );
        } catch {
          // localStorage unavailable (private mode etc.)
        }
      });
      await injectAudioMocks(page4);
      await setupApiMocks(page4, { surveyCode: SURVEY_CODE });

      await page4.goto(`${BASE_URL}/s/${SURVEY_CODE}`);
      await page4.waitForLoadState("networkidle");

      // Sanity check: confirm the pre-seeded localStorage key survived page
      // navigation and is readable from the page context.
      const seededAuth = await page4.evaluate(() =>
        localStorage.getItem("parlo-device-auth"),
      );
      console.log(`[${name}] parlo-device-auth after load:`, seededAuth);

      await page4.getByText(TEST_SURVEY.title).waitFor({ timeout: 10000 });
      await page4.getByRole("button", { name: "Start recording" }).click();
      await page4.getByText("Before you start").waitFor();
      await page4.getByRole("button", { name: "I agree, start recording" }).click();

      for (let i = 1; i <= 3; i++) {
        await page4.getByText(`${i} / 3`).waitFor();
        await page4.waitForTimeout(600);
        await page4.getByRole("button", { name: "Next" }).first().click();
      }

      await page4.getByText("Review your answers").waitFor({ timeout: 10000 });
      await page4.getByRole("button", { name: "Looks good, continue" }).click();

      // Capture an intermediate shot immediately after clicking Continue so
      // we can see which stage the app moved to (submit, phone, or done).
      await page4.waitForTimeout(1200);
      await shot(page4, "08a-after-review-continue");

      // With deviceAuth pre-seeded, phone+OTP are skipped → submit → done.
      // Use a generous timeout to allow the submit mutation to finish.
      try {
        await page4.getByText("All done!").first().waitFor({ timeout: 20000 });
        await page4.waitForTimeout(600);
        await shot(page4, "08-thank-you");
      } catch (err) {
        // Log what we actually see so we can debug.
        const bodyText = await page4.innerText("body").catch(() => "(no body)");
        console.error(`[${name}] Thank You never appeared. Body text preview:`, bodyText.slice(0, 300));
        await shot(page4, "08-stuck");
        throw err;
      }

      await page4.close();
      await ctx3.close();

      await context.close();
      await browser.close();
    } catch (err) {
      console.error(`[${name}] error:`, err);
      try { await context.close(); } catch {}
      try { await browser.close(); } catch {}
      throw err;
    }
  });
}
