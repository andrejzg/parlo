import { test, expect, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { injectAudioMocks } from "../fixtures/mock-audio";

const BASE_URL = "http://localhost:5173";
const OUT_ROOT = process.env.PARLO_SHOTS_DIR ?? "/tmp";

/**
 * Creator flow: brief → follow-ups → checkpoint → building → review.
 *
 * Drives the whole thing in "Type instead" mode (no speech engine in
 * Playwright's Chromium) with the backend stubbed: /brief/evaluate ticks
 * items based on how much was typed, /clarify hands back canned follow-ups,
 * /generate returns a voice/photo/video mix so the review badges get covered
 * too. Screenshots land in $PARLO_SHOTS_DIR/parlo-creator-<device>/.
 */

const DEVICES = ["iPhone SE", "Pixel 7", "iPhone 15 Pro Max"] as const;

const FOLLOW_UPS = [
  { question: "Which part of onboarding do you suspect is losing people?", hint: "A hunch is fine." },
  { question: "What would you do differently if you knew the answer?", hint: "One concrete change." },
  { question: "Is there anything the agent should avoid asking about?", hint: "Pricing, competitors, personal stuff…" },
  { question: "What does a brilliant answer sound like to you?", hint: "Describe one you'd love to hear." },
  { question: "How soon do you need these answers?", hint: "A rough timeline." },
  { question: "Anything else the agent should know?", hint: "Last chance before we build." },
];

async function mockCreatorApi(page: Page) {
  await page.route("**/api/surveys", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "creator-test-survey-id",
        code: "crtest",
        dashboardCode: "crtestdash",
        apiKey: "pk_test_key",
        uploadUrls: {
          brief: "https://fake-r2.example.com/upload/brief?token=b",
          audience: "https://fake-r2.example.com/upload/audience?token=a",
          gather: "https://fake-r2.example.com/upload/gather?token=g",
        },
      }),
    });
  });

  await page.route("https://fake-r2.example.com/**", async (route: Route) => {
    await route.fulfill({ status: 200, body: "" });
  });

  // No speech engine here, so voice mode polls Whisper; hand back nothing new.
  await page.route("**/api/surveys/*/transcribe", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "" }) });
  });

  // Checklist: short transcripts cover audience + goal, longer ones cover all five.
  await page.route("**/api/surveys/*/brief/evaluate", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { transcript: string };
    const full = body.transcript.length > 120;
    const p = (on: boolean) => (on ? 0.97 : 0.05);
    const items = [
      { id: "audience", satisfied: true, probability: p(true) },
      { id: "goal", satisfied: true, probability: p(true) },
      { id: "purpose", satisfied: full, probability: p(full) },
      { id: "tone", satisfied: full, probability: p(full) },
      { id: "length", satisfied: full, probability: p(full) },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, complete: full, provider: "typesafe", model: "jev-1.13.0" }),
    });
  });

  await page.route("**/api/surveys/*/clarify", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { brief: string; history: unknown[] };
    const index = body.history.length + 1;
    const q = FOLLOW_UPS[(index - 1) % FOLLOW_UPS.length];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...q, index }),
    });
  });

  await page.route("**/api/surveys/*/generate", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { brief?: string; clarifications?: unknown[] };
    expect(body.brief, "generate must receive the brief").toBeTruthy();
    expect(Array.isArray(body.clarifications)).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: "Why People Leave",
        questions: [
          { text: "What first drew you to us?", hint: "Question 1 of 3", type: "voice" },
          { text: "Show me where you usually work", hint: "Question 2 of 3", type: "photo" },
          { text: "Walk me through the setup wizard as you remember it", hint: "Question 3 of 3", type: "video" },
        ],
      }),
    });
  });

  await page.route("**/api/surveys/*/questions", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ questions: [] }) });
  });

  // Voice intro: fresh upload URL, then the save call once the blob landed.
  await page.route("**/api/surveys/*/intro/upload-url", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uploadUrl: "https://fake-r2.example.com/upload/intro?token=xyz" }),
    });
  });
  await page.route("**/api/surveys/*/intro", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as { durationMs?: number };
    expect(typeof body.durationMs).toBe("number");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, durationMs: body.durationMs }) });
  });
}

const BRIEF_SHORT = "I want to talk to customers who cancelled last quarter to learn why they left.";
const BRIEF_FULL =
  `${BRIEF_SHORT} We're deciding whether to rebuild onboarding so this feeds straight into that. ` +
  "Keep it warm and casual, like a friend asking, and short — five questions at most.";

// During page transitions AnimatePresence renders the exiting and entering
// screens at once (CLAUDE.md pitfall 8), so always target the newest one.
const question = (page: Page) => page.getByTestId("creation-question").last();

async function answerFollowUp(page: Page, text: string) {
  // Follow-ups open in text mode because the brief was typed.
  const ta = page.getByTestId("creation-textarea").last();
  await ta.waitFor({ timeout: 10_000 });
  await ta.fill(text);
  await page.getByTestId("creation-next").last().click();
}

for (const deviceName of DEVICES) {
  test(`creator brief flow on ${deviceName}`, async () => {
    test.setTimeout(120_000);
    const OUT = path.join(OUT_ROOT, `parlo-creator-${deviceName.toLowerCase().replace(/\s+/g, "-")}`);
    fs.mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch();
    const context = await browser.newContext({
      ...devices[deviceName],
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    await mockCreatorApi(page);
    await injectAudioMocks(page);

    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/01-landing.png` });

    await page.getByRole("button", { name: /create a parlo/i }).click();

    // ── Brief screen (voice mode by default) ──
    await page.getByText("Describe your research agent").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/02-brief-voice.png` });

    // All five unticked, CTA disabled.
    await expect(page.getByTestId("brief-continue")).toBeDisabled();
    for (const id of ["audience", "goal", "purpose", "tone", "length"]) {
      await expect(page.getByTestId(`brief-item-${id}`)).toHaveAttribute("data-satisfied", "false");
    }

    await page.getByRole("button", { name: /type instead/i }).click();
    const briefTa = page.getByTestId("brief-textarea");
    await briefTa.waitFor({ timeout: 5000 });

    // Type mode shows the checklist as a stack: item 1 on top, nothing ticked.
    await expect(page.getByTestId("brief-stack-current")).toHaveAttribute("data-item", "audience");

    // Partial brief → two ticks (dots), the stack has moved on to the first open item, still disabled.
    await briefTa.fill(BRIEF_SHORT);
    await expect(page.getByTestId("brief-item-goal")).toHaveAttribute("data-satisfied", "true", { timeout: 5000 });
    await expect(page.getByTestId("brief-item-tone")).toHaveAttribute("data-satisfied", "false");
    await expect(page.getByTestId("brief-stack-current")).toHaveAttribute("data-item", "purpose", { timeout: 3000 });
    await expect(page.getByTestId("brief-continue")).toBeDisabled();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/03-brief-partial.png` });

    // Full brief → all five ticks, the stack is done, CTA enabled.
    await briefTa.fill(BRIEF_FULL);
    await expect(page.getByTestId("brief-item-length")).toHaveAttribute("data-satisfied", "true", { timeout: 5000 });
    await expect(page.getByTestId("brief-stack-done")).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("brief-continue")).toBeEnabled();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/04-brief-complete.png` });

    // Switching modes keeps everything: back to voice seeds the transcript with the
    // typed brief, back to text brings it into the textarea again, ticks intact.
    await page.getByRole("button", { name: /switch to voice/i }).click();
    await expect(page.getByTestId("brief-transcript")).toContainText("five questions at most", { timeout: 5000 });
    await expect(page.getByTestId("brief-item-length")).toHaveAttribute("data-satisfied", "true");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/04b-brief-back-to-voice.png` });
    await page.getByRole("button", { name: /type instead/i }).click();
    await expect(page.getByTestId("brief-textarea")).toHaveValue(/five questions at most/, { timeout: 5000 });
    await expect(page.getByTestId("brief-stack-done")).toBeVisible();
    await expect(page.getByTestId("brief-continue")).toBeEnabled();
    await page.getByTestId("brief-continue").click();

    // ── Follow-up 1 & 2 → checkpoint ──
    await expect(question(page)).toHaveText(FOLLOW_UPS[0].question, { timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/05-followup-1.png` });
    await answerFollowUp(page, "Probably the setup wizard, it asks for too much upfront.");

    await expect(question(page)).toHaveText(FOLLOW_UPS[1].question, { timeout: 10_000 });
    await answerFollowUp(page, "Cut the wizard down to the two fields that matter.");

    await page.getByTestId("checkpoint-create").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/06-checkpoint.png` });

    // Keep going: follow-ups 3, 4, 5 → second checkpoint
    await page.getByTestId("checkpoint-continue").click();
    await expect(question(page)).toHaveText(FOLLOW_UPS[2].question, { timeout: 10_000 });
    await answerFollowUp(page, "Don't bring up pricing.");
    await expect(question(page)).toHaveText(FOLLOW_UPS[3].question, { timeout: 10_000 });
    await answerFollowUp(page, "A specific moment where they got stuck.");
    await expect(question(page)).toHaveText(FOLLOW_UPS[4].question, { timeout: 10_000 });
    await answerFollowUp(page, "By the end of the month.");

    await page.getByTestId("checkpoint-create").waitFor({ timeout: 10_000 });
    await page.getByTestId("checkpoint-create").click();

    // ── Building → review with media badges ──
    await page.getByRole("heading", { name: /building your agent/i }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/07-building.png` });

    await page.getByText("Review your").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/08-review.png`, fullPage: true });
    await page.getByText("Voice", { exact: true }).first().waitFor({ timeout: 5000 });
    await page.getByText("Photo", { exact: true }).first().waitFor({ timeout: 5000 });
    await page.getByText("Video", { exact: true }).first().waitFor({ timeout: 5000 });

    // ── Intro: record a hello, listen back, use it → phone ──
    const introSaved = page.waitForRequest((r) => r.method() === "PUT" && /\/api\/surveys\/[^/]+\/intro$/.test(r.url()));
    await page.getByRole("button", { name: /confirm & go live/i }).click();
    await page.getByTestId("intro-record").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/09-intro-idle.png`, fullPage: true });

    await page.getByTestId("intro-record").click();
    await page.getByTestId("intro-stop").waitFor({ timeout: 5000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/10-intro-recording.png`, fullPage: true });
    await page.getByTestId("intro-stop").click();
    await page.getByTestId("intro-use").waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/11-intro-recorded.png`, fullPage: true });

    await page.getByTestId("intro-use").click();
    await page.getByText("What's your phone number?").first().waitFor({ timeout: 10_000 });
    await introSaved;

    await context.close();
    await browser.close();
  });
}
