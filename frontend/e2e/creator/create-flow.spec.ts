import { test, expect, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { injectAudioMocks } from "../fixtures/mock-audio";

const BASE_URL = "http://localhost:5173";
const OUT_ROOT = process.env.PARLO_SHOTS_DIR ?? "/tmp";

/**
 * Creator flow, output-first: shape cards (six + More) → the one-blank sentence → the outputs cards → building
 * → review (swap / shorter / sharpen) → intro. Plus the "Something else"
 * escape hatch into the free brief on one device.
 *
 * Playwright's Chromium has no speech engine, so the blank is typed and the
 * follow-ups are answered in text mode. The backend is stubbed: /generate
 * returns a voice/photo/video mix (and the composed brief), /questions/swap a
 * canned replacement, /clarify canned follow-ups, /brief/evaluate ticks
 * items by how much was typed. Screenshots land in
 * $PARLO_SHOTS_DIR/parlo-creator-<device>/.
 */

const DEVICES = ["iPhone SE", "Pixel 7", "iPhone 15 Pro Max"] as const;

const COMPOSED_BRIEF = "Take the temperature of my team on the new offsite plan.\n\nWhat should come back to the group: Where the group stands, the split, and what's behind it.";

const FOLLOW_UPS = [
  { question: "Which part of the offsite plan do you expect pushback on?", hint: "A hunch is fine." },
  { question: "What would make you change the plan?", hint: "One concrete thing." },
];

const SWAPPED = { text: "What's the one thing that would make you skip it?", hint: "Question 2 of 3", type: "voice" as const };

type GenerateBody = {
  shape?: string;
  audience?: string;
  length?: string;
  topic?: string;
  outputs?: string[];
  brief?: string;
  clarifications?: unknown[];
};

type AdjustBody = { kind: string; questions: { text: string; type?: string }[] };
type ReviseBody = { questions: { text: string; type?: string }[]; clarifications: { question: string; answer: string }[] };
/** What the stubbed /questions/revise hands back: q1 reworded, the swapped q2 kept, q3 dropped, one added. */
const REVISED = [
  { text: "Which part of the plan worries you most?", hint: "Question 1 of 3", type: "voice" as const },
  { text: "What's the one thing that would make you skip it?", hint: "Question 2 of 3", type: "voice" as const },
  { text: "If a third couldn't make it, what would you change?", hint: "Question 3 of 3", type: "voice" as const },
];
const reviseBodies: ReviseBody[] = [];

const DRAFT = [
  { text: "What's your first reaction to the offsite plan?", hint: "Question 1 of 3", type: "voice" as const },
  { text: "Show me where you'd rather spend the day", hint: "Question 2 of 3", type: "photo" as const },
  { text: "Walk me through what an ideal venue looks like to you", hint: "Question 3 of 3", type: "video" as const },
];
const SHORTER = ["Gut feeling about the offsite?", "Snap where you'd rather be", "Walk me round your ideal venue"];

async function mockCreatorApi(page: Page, generateBodies: GenerateBody[], clarifyBriefs: string[], adjustBodies: AdjustBody[] = []) {
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

  // Free brief checklist: short transcripts cover audience + goal, longer ones cover all five.
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
    clarifyBriefs.push(body.brief);
    const index = body.history.length;
    const next = FOLLOW_UPS[Math.min(index, FOLLOW_UPS.length - 1)];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...next, index: index + 1 }),
    });
  });

  await page.route("**/api/surveys/*/generate", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as GenerateBody;
    generateBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: "The offsite plan", brief: body.brief ?? COMPOSED_BRIEF, questions: DRAFT }),
    });
  });

  await page.route("**/api/surveys/*/questions/revise", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    reviseBodies.push(route.request().postDataJSON() as ReviseBody);
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ questions: REVISED }) });
  });

  // The chips rewrite the draft in place: same count, order and type, new wording.
  await page.route("**/api/surveys/*/questions/adjust", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as AdjustBody;
    adjustBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        questions: body.questions.map((q, i) => ({
          text: body.kind === "shorter" ? SHORTER[i] ?? q.text : `${q.text} (playful)`,
          hint: `Question ${i + 1} of ${body.questions.length}`,
          type: q.type ?? "voice",
        })),
      }),
    });
  });

  await page.route("**/api/surveys/*/questions/swap", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { index: number; questions: { text: string }[] };
    expect(body.index).toBe(1);
    expect(body.questions.length).toBe(3);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ question: SWAPPED }) });
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

// During page transitions AnimatePresence renders the exiting and entering
// screens at once (CLAUDE.md pitfall 8), so always target the newest one.
const question = (page: Page) => page.getByTestId("creation-question").last();

async function answerFollowUp(page: Page, text: string) {
  const ta = page.getByTestId("creation-textarea").last();
  await ta.waitFor({ timeout: 10_000 });
  await ta.fill(text);
  await page.getByTestId("creation-next").last().click();
}

async function openCreator(
  deviceName: (typeof DEVICES)[number],
  generateBodies: GenerateBody[],
  clarifyBriefs: string[],
  adjustBodies: AdjustBody[] = [],
) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices[deviceName], permissions: ["microphone"] });
  const page = await context.newPage();
  await mockCreatorApi(page, generateBodies, clarifyBriefs, adjustBodies);
  await injectAudioMocks(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  return { browser, context, page };
}

for (const deviceName of DEVICES) {
  test(`creator output-first flow on ${deviceName}`, async () => {
    test.setTimeout(120_000);
    const OUT = path.join(OUT_ROOT, `parlo-creator-${deviceName.toLowerCase().replace(/\s+/g, "-")}`);
    fs.mkdirSync(OUT, { recursive: true });
    const generateBodies: GenerateBody[] = [];
    const clarifyBriefs: string[] = [];
    const adjustBodies: AdjustBody[] = [];
    const { browser, context, page } = await openCreator(deviceName, generateBodies, clarifyBriefs, adjustBodies);

    await page.screenshot({ path: `${OUT}/01-landing.png` });
    await page.getByRole("button", { name: /create a parlo/i }).click();

    // ── Shape cards ──
    await page.getByText("What do you want to find out?").waitFor({ timeout: 10_000 });
    await expect(page.getByTestId("shape-card")).toHaveCount(6);
    await expect(page.getByTestId("shape-more")).toBeVisible();
    // 2026-10-25: Regular check-in replaced Validate an idea (now retired on the backend only).
    await expect(page.locator('[data-testid="shape-card"][data-shape="checkin"]')).toContainText("Regular check-in");
    await expect(page.locator('[data-testid="shape-card"][data-shape="validate"]')).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/02-shapes.png`, fullPage: true });
    await page.locator('[data-testid="shape-card"][data-shape="feedback"]').click();

    // ── The sentence with one blank ──
    const ta = page.getByTestId("topic-textarea");
    await ta.waitFor({ timeout: 10_000 });
    // The card pre-picks its audience: feedback goes to your network.
    await expect(page.getByTestId("topic-sentence")).toContainText("Get honest feedback from my network on");
    await expect(page.getByTestId("topic-continue")).toBeDisabled();

    // The who chip swaps the phrase in the sentence; tapping it again puts "the group" back.
    await page.locator('[data-testid="who-chip"][data-value="team"]').click();
    await expect(page.getByTestId("topic-who")).toHaveText("my team");
    await page.locator('[data-testid="who-chip"][data-value="team"]').click();
    await expect(page.getByTestId("topic-who")).toHaveText("the group");
    await page.locator('[data-testid="who-chip"][data-value="team"]').click();
    await page.locator('[data-testid="length-chip"][data-value="deep"]').click();
    await expect(page.locator('[data-testid="length-chip"][data-value="deep"]')).toHaveAttribute("data-selected", "true");

    await ta.fill("the new offsite plan");
    await expect(page.getByTestId("topic-continue")).toBeEnabled();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/03-topic.png`, fullPage: true });
    await page.getByTestId("topic-continue").click();

    // ── Outputs? Eight cards, multi-select, build is live at once ──
    await page.getByRole("heading", { name: "Outputs?" }).waitFor({ timeout: 10_000 });
    await expect(page.getByTestId("outputs-subline")).toHaveText("Make content for your socials or just store the results in a sheet.");
    await expect(page.getByTestId("output-card")).toHaveCount(8);
    await expect(page.getByTestId("outputs-build")).toBeEnabled();
    // The Google Sheet starts on; everything else off.
    await expect(page.locator('[data-testid="output-card"][data-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="output-card"][data-output="sheet"]')).toHaveAttribute("data-selected", "true");
    await page.locator('[data-testid="output-card"][data-output="podcast"]').click();
    await page.locator('[data-testid="output-card"][data-output="instagram"]').click();
    await page.locator('[data-testid="output-card"][data-output="tiktok"]').click();
    await page.locator('[data-testid="output-card"][data-output="tiktok"]').click();
    await expect(page.locator('[data-testid="output-card"][data-output="podcast"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-testid="output-card"][data-output="tiktok"]')).toHaveAttribute("data-selected", "false");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/03b-outputs.png`, fullPage: true });
    await page.getByTestId("outputs-build").click();

    // ── Building → review with media badges and the report preview ──
    await page.getByRole("heading", { name: /building your agent/i }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/04-building.png` });

    await page.getByText("Review your").waitFor({ timeout: 20_000 });
    expect(generateBodies.length).toBe(1);
    expect(generateBodies[0]).toMatchObject({ shape: "feedback", audience: "team", length: "deep", topic: "the new offsite plan" });
    // Canonical order, whatever order they were tapped in; the toggled-off TikTok is gone.
    expect(generateBodies[0].outputs).toEqual(["sheet", "instagram", "podcast"]);
    expect(generateBodies[0].brief).toBeUndefined();
    await page.getByText("Voice", { exact: true }).first().waitFor({ timeout: 5000 });
    await page.getByText("Photo", { exact: true }).first().waitFor({ timeout: 5000 });
    await page.getByText("Video", { exact: true }).first().waitFor({ timeout: 5000 });
    await expect(page.getByTestId("review-report-preview")).toContainText("What works and what to fix");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/05-review.png`, fullPage: true });

    // ── "Shorter": the draft is rewritten in place; the review screen never leaves ──
    await page.getByTestId("review-adjust-shorter").click();
    await page.getByText("Gut feeling about the offsite?").waitFor({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /building your agent/i })).toHaveCount(0);
    await expect(page.getByText("Review your questions")).toBeVisible();
    expect(generateBodies.length).toBe(1);
    expect(adjustBodies.length).toBe(1);
    expect(adjustBodies[0].kind).toBe("shorter");
    expect(adjustBodies[0].questions.map((q) => q.text)).toEqual(DRAFT.map((q) => q.text));
    // Order and media types survive the rewrite.
    await page.getByText("Snap where you'd rather be").waitFor({ timeout: 5000 });
    await page.getByText("Photo", { exact: true }).first().waitFor({ timeout: 5000 });
    await expect(page.getByTestId("review-adjust-shorter")).toHaveAttribute("data-busy", "false");

    // ── The type chip is a picker: tap it, pick Video, the chip says Video ──
    await page.locator('[data-testid="review-type"][data-type="voice"]').first().click();
    await page.locator('[data-testid="review-type-option"][data-type="video"]').click();
    await expect(page.getByTestId("review-type-options")).toHaveCount(0);
    await expect(page.locator('[data-testid="review-type"][data-type="video"]')).toHaveCount(2);
    await page.locator('[data-testid="review-type"][data-type="video"]').first().click();
    await page.locator('[data-testid="review-type-option"][data-type="voice"]').click();
    await expect(page.locator('[data-testid="review-type"][data-type="video"]')).toHaveCount(1);

    // ── Add a question: the textarea takes focus, the header collapses, and picking a type keeps it that way (no jump) ──
    await page.getByRole("button", { name: /add question/i }).click();
    const newQuestion = page.getByRole("textbox", { name: "Question 4" });
    await expect(newQuestion).toBeFocused();
    await newQuestion.fill("Anything else on your mind?");
    await page.waitForTimeout(500); // the header's collapse transition
    const before = await newQuestion.boundingBox();
    await page.locator('[data-testid="review-type"][data-type="voice"]').last().click();
    await page.locator('[data-testid="review-type-option"][data-type="photo"]').click();
    await expect(newQuestion).toBeFocused();
    await expect(page.locator('[data-testid="review-type"][data-type="photo"]')).toHaveCount(2);
    await page.waitForTimeout(500);
    const after = await newQuestion.boundingBox();
    // Still editing, so the header stayed collapsed and the card did not move.
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
    // Tapping away ends editing.
    await page.locator('[data-testid="review-drag-rail"]').first().click();
    await expect(page.getByRole("textbox", { name: "Question 4" })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete question" }).last().click();
    await expect(page.getByRole("textbox", { name: "Question 4" })).toHaveCount(0);

    // ── Swap question 2 in place ──
    await page.getByTestId("review-swap").nth(1).click();
    await page.getByText(SWAPPED.text).waitFor({ timeout: 10_000 });
    await expect(page.getByText("Gut feeling about the offsite?")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/06-review-swapped.png`, fullPage: true });

    reviseBodies.length = 0;
    // ── A failed follow-up call never leaves the review screen (it used to bounce to the build) ──
    await page.route("**/api/surveys/*/clarify", (route: Route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal Server Error" }) }), { times: 1 });
    await page.getByTestId("review-sharpen").click();
    await page.getByText("Couldn't think of a follow-up just now").waitFor({ timeout: 10_000 });
    await expect(page.getByText("Review your questions")).toBeVisible();
    await expect(page.getByRole("heading", { name: /building your agent/i })).toHaveCount(0);
    await expect(page.getByTestId("review-sharpen")).toHaveText(/Sharpen it/);

    // ── "Sharpen it": follow-ups from the composed brief → checkpoint → the draft edited in place ──
    await page.getByTestId("review-sharpen").click();
    await expect(question(page)).toHaveText(FOLLOW_UPS[0].question, { timeout: 10_000 });
    expect(clarifyBriefs[0]).toBe(COMPOSED_BRIEF);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/07-followup-1.png` });
    await answerFollowUp(page, "The dates, people have holidays booked.");
    await expect(question(page)).toHaveText(FOLLOW_UPS[1].question, { timeout: 10_000 });
    await answerFollowUp(page, "If more than a third can't make it.");

    await page.getByTestId("checkpoint-update").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/08-checkpoint.png` });

    // The back arrow: review as it was, the swapped draft intact, nothing applied, the answers dropped.
    await page.getByTestId("checkpoint-back").click();
    await page.getByText("Review your").waitFor({ timeout: 10_000 });
    await expect(page.getByText(SWAPPED.text)).toBeVisible();
    expect(reviseBodies.length).toBe(0);
    await page.getByTestId("review-sharpen").click();
    // Dropped answers mean the follow-ups start again from the first one.
    await expect(question(page)).toHaveText(FOLLOW_UPS[0].question, { timeout: 10_000 });
    await answerFollowUp(page, "The dates, people have holidays booked.");
    await expect(question(page)).toHaveText(FOLLOW_UPS[1].question, { timeout: 10_000 });
    await answerFollowUp(page, "If more than a third can't make it.");
    await page.getByTestId("checkpoint-update").waitFor({ timeout: 10_000 });

    // "Update with feedback": straight back to review, the old cards dimmed, the revised ones fade in. No rebuild.
    await page.getByTestId("checkpoint-update").click();
    await page.getByText("Review your").waitFor({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /building your agent/i })).toHaveCount(0);
    await page.getByText(REVISED[0].text).waitFor({ timeout: 10_000 });
    await expect(page.getByText(REVISED[2].text)).toBeVisible();
    await expect(page.getByText(DRAFT[2].text)).toHaveCount(0);
    expect(generateBodies.length).toBe(1);
    expect(reviseBodies.length).toBe(1);
    expect(reviseBodies[0].clarifications).toHaveLength(2);
    // The draft sent is the one on screen: the swap survived "Sharpen it".
    expect(reviseBodies[0].questions.map((q) => q.text)).toEqual(["Gut feeling about the offsite?", SWAPPED.text, SHORTER[2]]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/09-review-revised.png`, fullPage: true });

    // ── Intro: record a hello, use it → phone ──
    const introSaved = page.waitForRequest((r) => r.method() === "PUT" && /\/api\/surveys\/[^/]+\/intro$/.test(r.url()));
    await page.getByRole("button", { name: /confirm & go live/i }).click();
    await page.getByTestId("intro-record").waitFor({ timeout: 10_000 });
    await page.getByTestId("intro-record").click();
    await page.getByTestId("intro-stop").waitFor({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.getByTestId("intro-stop").click();
    await page.getByTestId("intro-use").waitFor({ timeout: 5000 });
    await page.getByTestId("intro-use").click();
    await page.getByText("What's your phone number?").first().waitFor({ timeout: 10_000 });
    await introSaved;

    await context.close();
    await browser.close();
  });
}

test("More → \"Something else\" opens the free brief and builds from it (iPhone SE)", async () => {
  test.setTimeout(90_000);
  const OUT = path.join(OUT_ROOT, "parlo-creator-iphone-se");
  fs.mkdirSync(OUT, { recursive: true });
  const generateBodies: GenerateBody[] = [];
  const clarifyBriefs: string[] = [];
  const { browser, context, page } = await openCreator("iPhone SE", generateBodies, clarifyBriefs);

  await page.getByRole("button", { name: /create a parlo/i }).click();
  await page.getByText("What do you want to find out?").waitFor({ timeout: 10_000 });
  // "Something else" waits behind More, with the team and references cards; back returns to the deck.
  await page.getByTestId("shape-more").click();
  await expect(page.getByTestId("shape-card")).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/08-more.png`, fullPage: true });
  await page.getByTestId("shape-back").click();
  await expect(page.getByTestId("shape-card")).toHaveCount(6);
  await page.getByTestId("shape-more").click();
  await page.locator('[data-testid="shape-card"][data-shape="other"]').click();

  // Free brief opens in voice mode (mocked mic); type instead.
  await page.getByText("Describe what you want back").waitFor({ timeout: 10_000 });
  await expect(page.getByTestId("brief-continue")).toBeDisabled();
  await page.getByRole("button", { name: /type instead/i }).click();
  const briefTa = page.getByTestId("brief-textarea");
  await briefTa.waitFor({ timeout: 5000 });
  await expect(page.getByTestId("brief-stack-current")).toHaveAttribute("data-item", "audience");

  const short = "I want to talk to customers who cancelled last quarter to learn why they left.";
  await briefTa.fill(short);
  await expect(page.getByTestId("brief-item-goal")).toHaveAttribute("data-satisfied", "true", { timeout: 5000 });
  await expect(page.getByTestId("brief-continue")).toBeDisabled();

  await briefTa.fill(
    `${short} We're deciding whether to rebuild onboarding so this feeds straight into that. ` +
      "Keep it warm and casual, like a friend asking, and short — five questions at most.",
  );
  await expect(page.getByTestId("brief-stack-done")).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("brief-continue")).toBeEnabled();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/09-free-brief.png`, fullPage: true });
  await page.getByTestId("brief-continue").click();

  // Straight to building: no mandatory follow-ups any more.
  await page.getByRole("heading", { name: /building your agent/i }).waitFor({ timeout: 5000 });
  await page.getByText("Review your").waitFor({ timeout: 20_000 });
  expect(generateBodies.length).toBe(1);
  expect(generateBodies[0].shape).toBeUndefined();
  expect(generateBodies[0].brief).toContain("five questions at most");
  expect(clarifyBriefs).toHaveLength(0);
  // The free brief has no shape, so no report preview is promised.
  await expect(page.getByTestId("review-report-preview")).toHaveCount(0);

  await context.close();
  await browser.close();
});
