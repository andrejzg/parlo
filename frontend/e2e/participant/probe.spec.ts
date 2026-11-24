import path from "node:path";
import { test, expect, Page, Route } from "@playwright/test";
import { injectAudioMocks } from "../fixtures/mock-audio";
import { setupApiMocks, TEST_SURVEY, TEST_RESPONSE } from "../fixtures/mock-api";

const CODE = "probe123";
const TOKEN = "membertoken123";

/**
 * A study from the participant's side, the parts that decide what an answer
 * is worth:
 *
 * - the agent's follow-up after an answer that did not address the question
 *   (answer it, skip it, or never see it because the judge was slow);
 * - a testimonial ask: the marketing notice before anything is recorded, a
 *   tap to record, "I'd rather not", and the acknowledgement that travels
 *   with the submit;
 * - the trip to LinkedIn and back, which must not lose the sitting.
 *
 * The API is stubbed; the probe route decides what the "agent" says.
 */

// The smallest phone we support: a follow-up card or a testimonial notice
// takes room from the question, and this is where it runs out first.
test.use({ viewport: { width: 375, height: 667 } });

const SHOTS = path.join(process.env.PARLO_SHOTS_DIR ?? "/tmp", "parlo-probe");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

const NOTICE = "Acme Projects may use this recording in its marketing.";
const FOLLOW_UP = "You said it was fine: what made it fine for your team?";

type Survey = Record<string, unknown>;

function studySurvey(extra: Survey = {}): Survey {
  return { ...TEST_SURVEY, study: true, sponsor: { name: "Acme Projects" }, memberCount: 9, visibility: "private", ...extra };
}

/** The same survey with its second ask turned into a paid testimonial ask, as a returning member sees it. */
function withTestimonial(): Survey {
  return studySurvey({
    questions: [
      TEST_SURVEY.questions[0],
      {
        ...TEST_SURVEY.questions[1],
        text: "In a sentence or two, what would you tell a peer about Acme?",
        hint: null,
        round_purpose: "testimonial",
        round_reward_cents: 1500,
      },
    ],
    testimonialNotice: NOTICE,
    reward: { amountCents: 2500, currency: "USD" },
    member: { role: "member", displayName: "Dana Whitfield", hasAnswered: true },
    round: { number: 3, kind: "probe", closesAt: null },
  });
}

interface Calls {
  submits: Record<string, unknown>[];
  probes: string[];
  shown: Record<string, unknown>[];
  declines: string[];
}

/**
 * Signed-in device, fake mic, the default API stubs, then this spec's own on
 * top (registered later, so they win). `probe` answers each probe call in
 * turn; without it the agent has nothing to ask.
 */
async function openStudy(
  page: Page,
  opts: { survey?: Survey; token?: boolean; probe?: (call: number, body: string) => Promise<Record<string, unknown>> | Record<string, unknown> } = {}
): Promise<Calls> {
  const calls: Calls = { submits: [], probes: [], shown: [], declines: [] };
  const survey = opts.survey ?? studySurvey();
  await page.addInitScript(() => {
    localStorage.setItem("parlo-device-auth", JSON.stringify({ id: "parlo-device", phone: "+12345678901", verifiedAt: Date.now(), apiKey: "pk_test_key" }));
  });
  await injectAudioMocks(page);
  await setupApiMocks(page, { surveyCode: CODE });

  // With a personal link every call carries `?t=`, which the default globs do not match.
  await page.route(new RegExp(`/api/s/${CODE}(\\?.*)?$`), async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(survey) });
  });
  await page.route(new RegExp(`/api/s/${CODE}/responses(\\?.*)?$`), async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TEST_RESPONSE) });
  });
  await page.route(new RegExp(`/api/s/${CODE}/(report|reward|feed)(\\?.*)?$`), async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false, unlocked: false, markdown: null, offer: null, rewards: [], items: [] }) });
  });
  await page.route(new RegExp(`/api/s/${CODE}/asks/[^/]+/decline`), async (route: Route) => {
    calls.declines.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/responses/*/submit", async (route: Route) => {
    calls.submits.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, id: TEST_RESPONSE.id, memberToken: opts.token ? TOKEN : null, visibility: "private" }) });
  });
  await page.route("**/api/responses/*/probe/shown", async (route: Route) => {
    calls.shown.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/responses/*/probe", async (route: Route) => {
    // Multipart: the audio is bytes, the fields around it read as text.
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    calls.probes.push(body);
    const answer = opts.probe ? await opts.probe(calls.probes.length, body) : { verdict: null, transcript: "", probe: null, letGo: false };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }).catch(() => {
      // The page gave up waiting and moved on; nobody is listening for this one.
    });
  });

  await page.goto(opts.token ? `/s/${CODE}?t=${TOKEN}` : `/s/${CODE}`);
  await expect(page.getByText(TEST_SURVEY.title)).toBeVisible();
  return calls;
}

async function startAnswering(page: Page) {
  await page.getByRole("button", { name: /Start recording|Let's start|Answer/ }).first().click();
  await expect(page.getByText("Before you start")).toBeVisible();
  await page.getByRole("button", { name: /I agree/ }).click();
}

/** The mic is on and the timer is running. */
async function recording(page: Page) {
  await expect(page.getByText(/^\d+:\d{2}$/).first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(700);
}

function field(body: string, name: string): string | null {
  const m = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`));
  return m ? m[1] : null;
}

test("the agent follows up, the answer to it is heard with what came before, and the page moves on", async ({ page }) => {
  const calls = await openStudy(page, {
    probe: (n) =>
      n === 1
        ? { verdict: "unanswered", transcript: "It was fine, I guess.", probe: { text: FOLLOW_UP }, letGo: false, remaining: 1 }
        : { verdict: "answered", transcript: "It was fine, I guess. The weekly report saved us a day.", probe: null, letGo: false },
  });
  await startAnswering(page);

  await expect(page.getByText("1 / 3")).toBeVisible();
  await recording(page);
  await page.getByRole("button", { name: "Next" }).first().click();

  // The follow-up, on the same question, with two choices and nothing else.
  const card = page.getByTestId("probe-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("probe-text")).toHaveText(FOLLOW_UP);
  await expect(card).toContainText("One follow-up");
  await expect(page.getByText("1 / 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  expect(field(calls.probes[0], "questionId")).toBe("q1-uuid");
  expect(field(calls.probes[0], "transcriptSoFar")).toBeNull();
  // The server is told the participant saw it: only those are kept with the answer.
  await expect.poll(() => calls.shown.length).toBe(1);
  expect(calls.shown[0]).toEqual({ questionId: "q1-uuid", text: FOLLOW_UP });
  await page.waitForTimeout(400);
  await shot(page, "01-follow-up");

  // Answer it: one more clip of the same answer, then Next.
  await page.getByTestId("probe-answer").click();
  await expect(page.getByTestId("probe-text")).toBeVisible();
  await recording(page);
  await shot(page, "02-answering-follow-up");
  await page.getByRole("button", { name: "Next" }).first().click();

  await expect(page.getByText("2 / 3")).toBeVisible();
  await expect(page.getByTestId("probe-card")).toHaveCount(0);
  expect(calls.probes).toHaveLength(2);
  expect(field(calls.probes[1], "transcriptSoFar")).toBe("It was fine, I guess.");
});

test("skipping a follow-up moves on with what was recorded", async ({ page }) => {
  const calls = await openStudy(page, {
    probe: (n) => (n === 1 ? { verdict: "unanswered", transcript: "It was fine.", probe: { text: FOLLOW_UP }, letGo: false, remaining: 1 } : { verdict: null, transcript: "", probe: null, letGo: false }),
  });
  await startAnswering(page);
  await recording(page);
  await page.getByRole("button", { name: "Next" }).first().click();
  await expect(page.getByTestId("probe-card")).toBeVisible();

  await page.getByTestId("probe-skip").click();
  await expect(page.getByText("2 / 3")).toBeVisible();
  // The skipped follow-up was not answered, so nothing more went to the agent for that question.
  expect(calls.probes.filter((b) => field(b, "questionId") === "q1-uuid")).toHaveLength(1);

  // The rest of the sitting runs as usual and the first answer is on the review screen.
  for (const n of [2, 3]) {
    await expect(page.getByText(`${n} / 3`)).toBeVisible();
    await recording(page);
    await page.getByRole("button", { name: "Next" }).first().click();
  }
  await expect(page.getByText("Review your answers")).toBeVisible();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.getByText("All done!").first()).toBeVisible({ timeout: 15000 });
  expect(calls.submits).toHaveLength(1);
});

test("a slow judge holds the participant a few seconds at most, and its late follow-up is never shown", async ({ page }) => {
  test.slow();
  const calls = await openStudy(page, {
    probe: async (n) => {
      if (n === 1) await new Promise((resolve) => setTimeout(resolve, 8500));
      return n === 1
        ? { verdict: "unanswered", transcript: "It was fine.", probe: { text: FOLLOW_UP }, letGo: false, remaining: 1 }
        : { verdict: null, transcript: "", probe: null, letGo: false };
    },
  });
  await startAnswering(page);
  await recording(page);
  await page.getByRole("button", { name: "Next" }).first().click();

  // Held, and told so.
  await expect(page.getByRole("button", { name: "One moment…" })).toBeDisabled();
  await shot(page, "03-one-moment");
  // Then let through without a verdict.
  await expect(page.getByText("2 / 3")).toBeVisible({ timeout: 9000 });
  // The follow-up comes back after that: it belongs to a question that is gone.
  await page.waitForTimeout(3500);
  await expect(page.getByTestId("probe-card")).toHaveCount(0);
  expect(calls.shown).toHaveLength(0);
});

test("a paid round says what it pays for before the first question", async ({ page }) => {
  await openStudy(page, { survey: withTestimonial(), token: true });
  await expect(page.getByTestId("reward-offer")).toContainText("$25");
  await expect(page.getByTestId("reward-offer")).toHaveText("$25 for answers that address the question");
  await expect(page.getByTestId("reward-rule")).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "04-welcome-pay-rule");
});

test("a testimonial ask shows who may use it, waits for a tap, and its consent travels with the answers", async ({ page }) => {
  const calls = await openStudy(page, { survey: withTestimonial(), token: true });
  await startAnswering(page);

  // An ordinary ask first: recorded straight away, heard by the agent.
  await expect(page.getByText("1 / 2")).toBeVisible();
  await recording(page);
  await page.getByRole("button", { name: "Next" }).first().click();

  // The testimonial ask: the notice and the bonus, and the mic is off.
  await expect(page.getByText("2 / 2")).toBeVisible();
  const notice = page.getByTestId("testimonial-notice");
  await expect(notice).toContainText(NOTICE);
  await expect(notice).toContainText("Recording it is your OK.");
  await expect(page.getByTestId("testimonial-bonus")).toHaveText("$15 bonus");
  await expect(page.getByText("Nothing is recorded until you tap.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.getByText(/^\d+:\d{2}$/)).toHaveCount(0);
  await shot(page, "05-testimonial-ask");

  await page.getByTestId("testimonial-record").click();
  await recording(page);
  await shot(page, "06-testimonial-recording");
  await page.getByRole("button", { name: "Next" }).first().click();

  await expect(page.getByText("Review your answers")).toBeVisible();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.getByText("All done!").first()).toBeVisible({ timeout: 15000 });

  // The testimonial was never put to the agent's judge, and the submit names it as shown with its notice.
  expect(calls.probes.map((b) => field(b, "questionId"))).toEqual(["q1-uuid"]);
  expect(calls.submits).toHaveLength(1);
  expect(calls.submits[0].testimonialAck).toEqual(["q2-uuid"]);
  expect(calls.declines).toHaveLength(0);
});

test("\"I'd rather not\" takes the testimonial ask out of the sitting and tells the server", async ({ page }) => {
  const calls = await openStudy(page, { survey: withTestimonial(), token: true });
  await startAnswering(page);
  await recording(page);
  await page.getByRole("button", { name: "Next" }).first().click();

  await expect(page.getByTestId("testimonial-notice")).toBeVisible();
  await page.getByTestId("testimonial-decline").click();

  // It was the last ask: on to review with the one answer that was given.
  await expect(page.getByText("Review your answers")).toBeVisible();
  await expect(page.getByText("what would you tell a peer about Acme")).toHaveCount(0);
  await expect.poll(() => calls.declines).toEqual([`/api/s/${CODE}/asks/q2-uuid/decline`]);

  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.getByText("All done!").first()).toBeVisible({ timeout: 15000 });
  expect(calls.submits).toHaveLength(1);
  expect(calls.submits[0].testimonialAck).toBeUndefined();
});

test("coming back from LinkedIn keeps the answers and sends them", async ({ page }) => {
  // First visit: this device has never connected LinkedIn, so review leads to the connect step.
  let connected = false;
  const calls = await openStudy(page);
  await page.route("**/api/auth/linkedin/profile*", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(connected ? { connected: true, name: "Test Participant", email: null, photoUrl: null } : { connected: false }) });
  });
  await startAnswering(page);
  for (const n of [1, 2, 3]) {
    await expect(page.getByText(`${n} / 3`)).toBeVisible();
    await recording(page);
    await page.getByRole("button", { name: "Next" }).first().click();
  }
  await expect(page.getByText("Review your answers")).toBeVisible();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.getByRole("button", { name: "Continue with LinkedIn" })).toBeVisible();

  // The round trip: LinkedIn sends the browser back to the same page, loaded afresh.
  connected = true;
  await page.goto(`/s/${CODE}?linkedin=connected`);
  await expect(page.getByText("You're connected!")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("All done!").first()).toBeVisible({ timeout: 15000 });
  expect(calls.submits).toHaveLength(1);
});
