import { test, expect, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { injectAudioMocks } from "../fixtures/mock-audio";

const BASE_URL = "http://localhost:5173";
const OUT_ROOT = process.env.PARLO_SHOTS_DIR ?? "/tmp";

/**
 * Creator flow, output-first: shape cards (six + More) → the sentence + who/length chips (taps only) → the outputs cards → building
 * → the opener (review went on 2026-10-25). Plus the "Something else"
 * escape hatch into the free brief on one device.
 *
 * Playwright's Chromium has no speech engine, so the
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
  timing?: string;
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
  // Follow-ups open in voice mode (nothing before them is typed any more); take the escape hatch.
  const typeInstead = page.getByRole("button", { name: /type instead/i }).last();
  if (await typeInstead.isVisible({ timeout: 3000 }).catch(() => false)) await typeInstead.click();
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

    // ── The sentence, taps only (the blank went on 2026-10-25): Continue is live at once ──
    await page.getByTestId("topic-sentence").waitFor({ timeout: 10_000 });
    await expect(page.getByTestId("topic-textarea")).toHaveCount(0);
    // The card pre-picks its audience: feedback goes to your network.
    await expect(page.getByTestId("topic-sentence")).toHaveText("Get honest feedback from my network");
    await expect(page.getByTestId("topic-continue")).toBeEnabled();

    // The who chip swaps the phrase in the sentence; tapping it again puts "the group" back.
    await page.locator('[data-testid="who-chip"][data-value="team"]').click();
    await expect(page.getByTestId("topic-who")).toHaveText("my team");
    await page.locator('[data-testid="who-chip"][data-value="team"]').click();
    await expect(page.getByTestId("topic-who")).toHaveText("the group");
    await page.locator('[data-testid="who-chip"][data-value="team"]').click();
    await page.locator('[data-testid="length-chip"][data-value="deep"]').click();
    await expect(page.locator('[data-testid="length-chip"][data-value="deep"]')).toHaveAttribute("data-selected", "true");

    // The third row is the shape's own question (2026-10-25): feedback asks when you need it, "This week" on by default.
    await expect(page.getByTestId("topic-timing")).toHaveAttribute("data-row", "deadline");
    await expect(page.getByTestId("timing-chip")).toHaveCount(3);
    await expect(page.locator('[data-testid="timing-chip"][data-value="week"]')).toHaveAttribute("data-selected", "true");
    await page.locator('[data-testid="timing-chip"][data-value="today"]').click();
    await expect(page.locator('[data-testid="timing-chip"][data-value="today"]')).toHaveAttribute("data-selected", "true");

    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/03-topic.png`, fullPage: true });
    await page.getByTestId("topic-continue").click();

    // ── What should it make? Six content-type cards (2026-10-25), multi-select, build is live at once ──
    await page.getByRole("heading", { name: "What should it make?" }).waitFor({ timeout: 10_000 });
    await expect(page.getByTestId("outputs-subline")).toHaveText("From everyone's answers. The report always comes back.");
    await expect(page.getByTestId("output-card")).toHaveCount(6);
    await expect(page.getByTestId("outputs-build")).toBeEnabled();
    // Feedback pre-picks only Google Sheet & Drive; everything else off.
    await expect(page.locator('[data-testid="output-card"][data-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="output-card"][data-output="sheet"]')).toHaveAttribute("data-selected", "true");
    await page.locator('[data-testid="output-card"][data-output="episode"]').click();
    await page.locator('[data-testid="output-card"][data-output="carousel"]').click();
    await page.locator('[data-testid="output-card"][data-output="clips"]').click();
    await page.locator('[data-testid="output-card"][data-output="clips"]').click();
    await expect(page.locator('[data-testid="output-card"][data-output="episode"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('[data-testid="output-card"][data-output="clips"]')).toHaveAttribute("data-selected", "false");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/03b-outputs.png`, fullPage: true });
    await page.getByTestId("outputs-build").click();

    // ── Straight to the opener: nothing is built yet (the review screen went on 2026-10-25; the building screen is the last step, behind OTP) ──
    await page.getByTestId("intro-record").waitFor({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /building your agent/i })).toHaveCount(0);
    expect(generateBodies.length).toBe(0);
    await expect(page.getByText("Record an opener for the group")).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/05-opener.png`, fullPage: true });

    // ── The opener: record it, use it → phone ──
    const introSaved = page.waitForRequest((r) => r.method() === "PUT" && /\/api\/surveys\/[^/]+\/intro$/.test(r.url()));
    await page.getByTestId("intro-record").click();
    await page.getByTestId("intro-stop").waitFor({ timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.getByTestId("intro-stop").click();
    await page.getByTestId("intro-use").waitFor({ timeout: 5000 });
    await page.getByTestId("intro-use").click();
    await page.getByText("What's your phone number?").first().waitFor({ timeout: 10_000 });
    await introSaved;
    // Still nothing built: the build is the last step, behind OTP.
    expect(generateBodies.length).toBe(0);

    await context.close();
    await browser.close();
  });
}

test("logged-in device: Build it → opener → building last → ready (iPhone SE)", async () => {
  test.setTimeout(90_000);
  const OUT = path.join(OUT_ROOT, "parlo-creator-iphone-se");
  fs.mkdirSync(OUT, { recursive: true });
  const generateBodies: GenerateBody[] = [];
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
  await mockCreatorApi(page, generateBodies, []);
  await page.route("**/api/my/surveys", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ surveys: [] }) }));
  await page.route("**/api/auth/linkedin/profile", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connected: true, name: "Andrej", photoUrl: null }) }));
  await page.route("**/api/surveys/*/claim", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, apiKey: "pk_test_key", userId: "u1", phone: "+447700900123" }) }));
  await page.route("**/api/my/surveys/*/settings", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await injectAudioMocks(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /create a parlo/i }).click();
  await page.locator('[data-testid="shape-card"][data-shape="feedback"]').click();
  await page.getByTestId("topic-continue").click();
  await page.getByTestId("outputs-build").click();

  // The opener first; nothing is built yet.
  await page.getByTestId("intro-record").waitFor({ timeout: 10_000 });
  expect(generateBodies.length).toBe(0);
  await page.getByTestId("intro-skip").click();

  // The build is the last screen, then the link.
  await page.getByRole("heading", { name: /building your agent/i }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-building-last.png` });
  await page.getByRole("heading", { name: /your agent is ready/i }).waitFor({ timeout: 20_000 });
  expect(generateBodies.length).toBe(1);
  expect(generateBodies[0]).toMatchObject({ shape: "feedback", audience: "network", length: "few", timing: "week" });
  expect(generateBodies[0].outputs).toEqual(["sheet"]);
  expect(generateBodies[0].brief).toBeUndefined();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/07-ready.png`, fullPage: true });

  await context.close();
  await browser.close();
});

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

  // Straight to the opener: nothing is built yet, no follow-ups, no building screen here.
  await page.getByTestId("intro-record").waitFor({ timeout: 20_000 });
  expect(generateBodies.length).toBe(0);
  expect(clarifyBriefs).toHaveLength(0);

  await context.close();
  await browser.close();
});
