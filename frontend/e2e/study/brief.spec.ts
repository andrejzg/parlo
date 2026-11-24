import { test, expect, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:5173";
const OUT_ROOT = process.env.PARLO_SHOTS_DIR ?? "/tmp";
const SURVEY_ID = "study123";

/**
 * The study page (`/study/:surveyId`): the brief both sides work on.
 * `GET …/brief` and the mutations are stubbed with a board in a known state:
 * four questions (one answered, two emerging, one open), a suggestion from
 * the agent, a round out and a round planned. Run once as the research team
 * and once as the client, on a phone and on a desktop.
 * Screenshots land in $PARLO_SHOTS_DIR/parlo-study-<seat>-<device>/.
 */

function boardFixture(role: "owner" | "client", extra: { steers?: unknown[]; planning?: boolean } = {}) {
  const manager = role === "owner";
  const who = (name: string, label: string) => (manager ? name : label);
  const answer = (id: string, name: string, label: string, segment: string) => ({
    id,
    responseId: `r-${id}`,
    who: who(name, label),
    segment,
    roundNumber: 1,
    questionId: "q1",
    questionText: "What almost made you leave?",
    questionType: "voice",
    transcription: "The price went up by forty percent with two weeks notice.",
    transcriptionStatus: "completed",
    durationMs: 14000,
    submittedAt: new Date(Date.now() - 3_600_000).toISOString(),
    audioUrl: "https://api.example.test/audio/a.wav",
    videoUrl: null,
    imageUrl: null,
  });
  const item = (id: string, text: string, status: string, origin: string, finding: string | null, voices: number, evidence: unknown[] = []) => ({
    id,
    text,
    status,
    origin,
    addedBy: origin === "client" ? "Maria Chen" : null,
    finding,
    why: null,
    voices,
    setByHand: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidence,
  });
  return {
    survey: { id: SURVEY_ID, code: "studycode", title: "Why mid-market teams switch project tools", sponsor: "Acme Projects", dashboardCode: manager ? "dashcode1234" : null },
    you: { userId: manager ? "u-owner" : "u-client", role, canManage: manager },
    goal: "We want to learn why mid-market teams choose a competitor over Acme, what almost made current customers leave, and how pricing changes at renewal are perceived.",
    items: [
      item("i1", "Why do mid-market teams choose a competitor over Acme?", "answered", "seed", "Price first, then how long onboarding takes.", 3, [
        { quote: "We picked the competitor mostly because of price.", answer: answer("a1", "Marcus Oyelaran", "Competitor user 1", "Competitor user") },
        { quote: "Their onboarding took two days, yours took three weeks.", answer: answer("a2", "Marcus Oyelaran", "Competitor user 1", "Competitor user") },
      ]),
      item("i2", "What almost made current customers leave?", "emerging", "seed", "A renewal price jump with little notice.", 2, [
        { quote: "The price went up by forty percent with two weeks notice.", answer: answer("a3", "Dana Whitfield", "Customer 1", "Customer") },
      ]),
      item("i3", "How much notice before a price change would feel fair?", "emerging", "client", "Three months, with a clear reason.", 1),
      item("i4", "Which reports do customers rely on every month?", "open", "researcher", null, 0),
    ],
    suggestions: [
      { ...item("s1", "Does migration cost keep unhappy customers from leaving?", "suggested", "agent", null, 2), why: "Two customers said the cost of moving, not the product, kept them." },
    ],
    dropped: [],
    steers: extra.steers ?? [],
    planning: extra.planning ?? false,
    nextRound: {
      id: "round3",
      number: 3,
      kind: "probe",
      rationale: "The client asked what a fair increase looks like, so this round asks the customers.",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      serves: ["i3"],
      asks: [{ id: "ask1", text: "What would a fair price increase have looked like for you?", hint: "think of your last renewal", type: "voice", targets: [who("Dana Whitfield", "Customer 1"), who("Priya Raman", "Customer 2")] }],
      cost: { rewardCents: 1000, reach: 2, maxCents: 2000, budgetCents: 5000, committedCents: 2000, remainingCents: 3000, fits: true },
    },
    liveRound: {
      id: "round2",
      number: 2,
      kind: "probe",
      sentAt: new Date(Date.now() - 1_800_000).toISOString(),
      closesAt: null,
      serves: ["i1"],
      asks: [{ id: "ask0", text: "What did onboarding look like in your first two weeks?", hint: null, type: "voice", targets: [who("Marcus Oyelaran", "Competitor user 1")] }],
      answered: 0,
      rewardCents: 1500,
    },
    timeline: [
      { id: "e3", type: "round_proposed", body: "The client asked what a fair increase looks like.", itemId: null, itemText: null, by: "The agent", role: "agent", roundNumber: 3, at: new Date(Date.now() - 120_000).toISOString() },
      { id: "e2", type: "steer", body: "Ask our customers what a fair increase would look like.", itemId: "i3", itemText: "How much notice before a price change would feel fair?", by: "Maria Chen", role: "client", roundNumber: null, at: new Date(Date.now() - 180_000).toISOString() },
      { id: "e1", type: "item_added", body: null, itemId: "i3", itemText: "How much notice before a price change would feel fair?", by: "Maria Chen", role: "client", roundNumber: null, at: new Date(Date.now() - 240_000).toISOString() },
    ],
    report: { markdown: "## Summary\nPrice and onboarding time decide it.", updatedAt: new Date().toISOString() },
    voices: 4,
    answers: 6,
    team: [
      { userId: "u-owner", role: "owner", name: "Andrej Zukov" },
      { userId: "u-client", role: "client", name: "Maria Chen" },
    ],
    rewards: { currency: "USD", defaultCents: 1000, budgetCents: 5000, committedCents: 2000, remainingCents: 3000, sentCents: 2000, owedCents: 0, heldCount: 0, failedCount: 0, payouts: "sandbox" },
  };
}

interface Calls {
  steers: { note: string; itemId: string | null }[];
  approvals: unknown[];
  items: string[];
}

async function mockStudyApi(page: Page, role: "owner" | "client", calls: Calls) {
  await page.route(`**/api/my/surveys/${SURVEY_ID}/brief`, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(boardFixture(role)) });
  });
  await page.route(`**/api/my/surveys/${SURVEY_ID}/brief/steer`, async (route: Route) => {
    const body = route.request().postDataJSON() as { note: string; itemId: string | null };
    calls.steers.push(body);
    const steer = { id: "st1", itemId: body.itemId, itemText: null, body: body.note, by: role === "client" ? "Maria Chen" : "Andrej Zukov", role, at: new Date().toISOString() };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(boardFixture(role, { steers: [steer], planning: true })) });
  });
  await page.route(`**/api/my/surveys/${SURVEY_ID}/brief/items`, async (route: Route) => {
    calls.items.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(boardFixture(role)) });
  });
  await page.route(`**/api/my/surveys/${SURVEY_ID}/rounds/round3/approve`, async (route: Route) => {
    if (role !== "owner") return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Only the research team can do that" }) });
    calls.approvals.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, round: {}, notified: 2 }) });
  });
  await page.route("https://api.example.test/**", async (route: Route) => route.fulfill({ status: 200, contentType: "audio/wav", body: "" }));
}

async function openStudy(deviceName: string, role: "owner" | "client") {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices[deviceName] });
  await context.addInitScript(() => {
    localStorage.setItem("parlo-device-auth", JSON.stringify({ id: "parlo-device", phone: "+447700900123", verifiedAt: Date.now(), apiKey: "pk_test_key" }));
  });
  const page = await context.newPage();
  const calls: Calls = { steers: [], approvals: [], items: [] };
  await mockStudyApi(page, role, calls);
  await page.goto(`${BASE_URL}/study/${SURVEY_ID}`);
  await expect(page.getByTestId("study-page")).toHaveAttribute("data-role", role, { timeout: 10_000 });
  const out = path.join(OUT_ROOT, `parlo-study-${role}-${deviceName.toLowerCase().replace(/\s+/g, "-")}`);
  fs.mkdirSync(out, { recursive: true });
  return { browser, page, calls, out };
}

for (const deviceName of ["iPhone SE", "Desktop Chrome"] as const) {
  test(`the research team prices and sends the planned round (${deviceName})`, async () => {
    const { browser, page, calls, out } = await openStudy(deviceName, "owner");

    const items = page.getByTestId("brief-item");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAttribute("data-status", "answered");
    await expect(items.nth(0)).toContainText("Price first, then how long onboarding takes.");
    // The research team sees who said it.
    await expect(items.nth(0)).toContainText("Marcus Oyelaran");
    await expect(items.nth(3)).toContainText("No answer to this yet.");
    await expect(page.getByText("1 of 4 answered")).toBeVisible();
    await expect(page.getByTestId("brief-suggestion")).toContainText("Does migration cost keep unhappy customers from leaving?");

    const next = page.getByTestId("next-round");
    await expect(next).toHaveAttribute("data-state", "planned");
    await expect(next).toContainText("Round 3");
    await expect(next).toContainText("How much notice before a price change would feel fair?");
    await expect(page.getByTestId("round-price")).toHaveValue("10");
    await expect(page.getByTestId("round-cost")).toContainText("Up to 2 people × $10 = $20");
    await page.screenshot({ path: path.join(out, "01-brief.png"), fullPage: true });

    // A price the budget cannot carry blocks sending.
    await page.getByTestId("round-price").fill("40");
    await expect(page.getByTestId("round-cost")).toContainText("Lower the reward or raise the budget");
    await expect(page.getByTestId("round-send")).toBeDisabled();

    await page.getByTestId("round-price").fill("15");
    await expect(page.getByTestId("round-cost")).toContainText("Up to 2 people × $15 = $30");
    await page.getByTestId("round-send").click();
    await expect.poll(() => calls.approvals.length).toBe(1);
    expect(calls.approvals[0]).toEqual({ rewardCents: 1500 });
    await browser.close();
  });

  test(`the client steers and cannot send (${deviceName})`, async () => {
    const { browser, page, calls, out } = await openStudy(deviceName, "client");

    const items = page.getByTestId("brief-item");
    await expect(items).toHaveCount(4);
    // Labels, never names.
    await expect(items.nth(0)).toContainText("Competitor user 1");
    await expect(page.getByText("Marcus Oyelaran")).toHaveCount(0);
    await expect(page.getByText("Dana Whitfield")).toHaveCount(0);

    // No price, no send, no way into the dashboard.
    await expect(page.getByTestId("round-price")).toHaveCount(0);
    await expect(page.getByTestId("round-send")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open the dashboard" })).toHaveCount(0);
    await expect(page.getByTestId("next-round")).toContainText("The research team sends rounds");
    await expect(page.getByTestId("round-cost")).toContainText("Up to 2 people × $10 = $20");

    // "Dig into this" on the open question.
    await items.nth(3).getByTestId("steer-open").click();
    await items.nth(3).getByTestId("steer-input").fill("Ask which report they would miss most.");
    await items.nth(3).getByTestId("steer-send").click();
    await expect.poll(() => calls.steers.length).toBe(1);
    expect(calls.steers[0]).toEqual({ note: "Ask which report they would miss most.", itemId: "i4" });
    await expect(items.nth(3).getByTestId("steer-row")).toContainText("Ask which report they would miss most.");
    await expect(items.nth(3).getByTestId("steer-row")).toContainText("The agent is working this into the next round");
    await expect(page.getByTestId("next-round")).toHaveAttribute("data-state", "planning");

    await page.getByTestId("brief-add-input").fill("Who signs off on switching tools?");
    await page.getByTestId("brief-add").click();
    await expect.poll(() => calls.items).toEqual(["Who signs off on switching tools?"]);

    await page.getByTestId("study-tab-report").click();
    await expect(page.getByTestId("study-report")).toContainText("Price and onboarding time decide it.");
    await page.screenshot({ path: path.join(out, "02-report.png"), fullPage: true });
    await browser.close();
  });
}
