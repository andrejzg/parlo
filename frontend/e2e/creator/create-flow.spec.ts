import { test, expect, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { injectAudioMocks } from "../fixtures/mock-audio";

const BASE_URL = "http://localhost:5173";
const OUT_ROOT = process.env.PARLO_SHOTS_DIR ?? "/tmp";

/**
 * Creator flow since 2026-10-25 ("dumb af"): landing → record the opener →
 * phone. A verified device skips phone / OTP, so a second test walks the
 * opener → "Building your agent…" (last) → "Your agent is ready.", and
 * asserts that the build was given the opener's Whisper transcript as the
 * brief. The backend is stubbed: /surveys, /transcribe (a canned
 * transcript), /generate (a voice/photo/video mix), the intro upload and
 * save, claim, settings, the home list and the LinkedIn profile.
 * Screenshots land in $PARLO_SHOTS_DIR/parlo-creator-<device>/.
 */

const DEVICES = ["iPhone SE", "Pixel 7", "iPhone 15 Pro Max"] as const;

const OPENER_TRANSCRIPT =
  "Hi, it's Andrej. I'm trying to work out what slowed our last launch down, so I'd love thirty seconds from each of you on what got in your way and what you'd change. I'll share what everyone said back with the group.";

type GenerateBody = { brief?: string; shape?: string; clarifications?: unknown[] };

async function mockCreatorApi(page: Page, generateBodies: GenerateBody[], transcribeCalls: { current: number }) {
  await page.route("**/api/surveys", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "survey-e2e",
        code: "e2ecode1",
        dashboardCode: "dash12345678",
        apiKey: "pk_test_key",
        uploadUrls: {
          brief: "https://fake-r2.example.com/upload/brief?token=a",
          audience: "https://fake-r2.example.com/upload/audience?token=b",
          gather: "https://fake-r2.example.com/upload/gather?token=c",
        },
      }),
    });
  });
  await page.route("https://fake-r2.example.com/**", async (route: Route) => {
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/surveys/*/transcribe", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    transcribeCalls.current += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: OPENER_TRANSCRIPT }) });
  });
  await page.route("**/api/surveys/*/generate", async (route: Route) => {
    generateBodies.push(route.request().postDataJSON() as GenerateBody);
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: "What slowed the launch",
        brief: (generateBodies[generateBodies.length - 1]?.brief ?? ""),
        questions: [
          { text: "What got in your way during the launch?", hint: "Be specific", type: "voice" },
          { text: "Show us the thing that slowed you down most.", hint: "A photo is fine", type: "photo" },
          { text: "In ten seconds: what would you change next time?", hint: "Vertical video", type: "video" },
        ],
      }),
    });
  });
  // The opener: fresh upload URL, then the save call once the blob landed.
  await page.route("**/api/surveys/*/intro/upload-url", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ uploadUrl: "https://fake-r2.example.com/upload/intro?token=xyz" }) });
  });
  await page.route("**/api/surveys/*/intro", async (route: Route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, durationMs: 1200 }) });
    } else {
      await route.fallback();
    }
  });
  await page.route("**/api/surveys/*/claim", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, apiKey: "pk_test_key", userId: "u1", phone: "+447700900123" }) }));
  await page.route("**/api/my/surveys", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ surveys: [] }) }));
  await page.route("**/api/my/surveys/*/settings", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/auth/linkedin/profile", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: true, name: "Andrej", photoUrl: null }) }));
}

async function recordOpener(page: Page) {
  await page.getByTestId("intro-record").waitFor({ timeout: 10_000 });
  await page.getByTestId("intro-record").click();
  await page.getByTestId("intro-stop").waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.getByTestId("intro-stop").click();
  await page.getByTestId("intro-use").waitFor({ timeout: 5000 });
}

for (const deviceName of DEVICES) {
  test(`creator flow on ${deviceName}: landing → opener → phone`, async () => {
    test.setTimeout(60_000);
    const OUT = path.join(OUT_ROOT, `parlo-creator-${deviceName.toLowerCase().replace(/\s+/g, "-")}`);
    fs.mkdirSync(OUT, { recursive: true });
    const generateBodies: GenerateBody[] = [];
    const transcribeCalls = { current: 0 };
    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices[deviceName], permissions: ["microphone"] });
    const page = await context.newPage();
    await mockCreatorApi(page, generateBodies, transcribeCalls);
    await injectAudioMocks(page);
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);

    await page.screenshot({ path: `${OUT}/01-landing.png` });
    await page.getByRole("button", { name: /create a parlo/i }).click();

    // ── Straight to the opener. No cards, no chips, no skip: the opener is the brief. ──
    await page.getByTestId("intro-record").waitFor({ timeout: 10_000 });
    await expect(page.getByText("Record an opener for the group")).toBeVisible();
    await expect(page.getByTestId("shape-card")).toHaveCount(0);
    await expect(page.getByTestId("intro-skip")).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/02-opener.png`, fullPage: true });

    const introSaved = page.waitForRequest((r) => r.method() === "PUT" && /\/api\/surveys\/[^/]+\/intro$/.test(r.url()));
    await recordOpener(page);
    await page.screenshot({ path: `${OUT}/03-opener-recorded.png`, fullPage: true });
    await page.getByTestId("intro-use").click();

    // ── Phone. Nothing is built yet; the take went to Whisper and to R2. ──
    await page.getByText("What's your phone number?").first().waitFor({ timeout: 10_000 });
    await introSaved;
    await expect.poll(() => transcribeCalls.current, { timeout: 5000 }).toBe(1);
    expect(generateBodies.length).toBe(0);
    await page.screenshot({ path: `${OUT}/04-phone.png` });

    await context.close();
    await browser.close();
  });
}

test("verified device: opener → building last → ready, built from the opener's transcript (iPhone SE)", async () => {
  test.setTimeout(60_000);
  const OUT = path.join(OUT_ROOT, "parlo-creator-iphone-se");
  fs.mkdirSync(OUT, { recursive: true });
  const generateBodies: GenerateBody[] = [];
  const transcribeCalls = { current: 0 };
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone SE"], permissions: ["microphone"] });
  // A device that verified before: phone + OTP are skipped, so the building screen is reachable.
  await context.addInitScript(() => {
    localStorage.setItem(
      "parlo-device-auth",
      JSON.stringify({ id: "parlo-device", phone: "+447700900123", verifiedAt: Date.now(), apiKey: "pk_test_key" })
    );
  });
  const page = await context.newPage();
  await mockCreatorApi(page, generateBodies, transcribeCalls);
  await injectAudioMocks(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /create a parlo/i }).click();

  await recordOpener(page);
  await page.getByTestId("intro-use").click();

  // The build is the last screen, then the link.
  await page.getByRole("heading", { name: /building your agent/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/05-building-last.png` });
  await page.getByRole("heading", { name: /your agent is ready/i }).waitFor({ timeout: 20_000 });
  expect(transcribeCalls.current).toBe(1);
  expect(generateBodies.length).toBe(1);
  // The opener's transcript is the brief; no shape, no chips.
  expect(generateBodies[0].brief).toBe(OPENER_TRANSCRIPT);
  expect(generateBodies[0].shape).toBeUndefined();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-ready.png`, fullPage: true });

  await context.close();
  await browser.close();
});
