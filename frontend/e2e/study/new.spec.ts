import { test, expect, Route } from "@playwright/test";

/**
 * "Start a study" (`/study/new`): a researcher pastes a brief and lands on
 * the study's brief. `POST /api/studies` and the board are stubbed; the test
 * checks what the screen sends (money as cents, own questions as a list) and
 * where it goes. Signed in by a seeded device record; the phone-and-code
 * path needs Firebase and is not covered here.
 */

const STUDY_ID = "newstudy123";

test("a signed-in researcher starts a study from a brief", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("parlo-device-auth", JSON.stringify({ id: "parlo-device", phone: "+447700900123", verifiedAt: Date.now(), apiKey: "pk_test_key" }));
  });

  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/studies", async (route: Route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        surveyId: STUDY_ID,
        code: "newcode1",
        dashboardCode: "newdash12345",
        title: "Why teams switch",
        sponsor: "Acme Projects",
        questions: [{ text: "What almost made you leave?", hint: "", type: "voice" }],
        studyLink: `https://parlo.me/study/${STUDY_ID}`,
        dashboardLink: "https://parlo.me/d/newdash12345",
        shareLink: "https://parlo.me/s/why-teams-switch-newcode1",
      }),
    });
  });
  await page.route(`**/api/my/surveys/${STUDY_ID}/brief`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        survey: { id: STUDY_ID, code: "newcode1", title: "Why teams switch", sponsor: "Acme Projects", study: true, dashboardCode: "newdash12345" },
        you: { userId: "u-owner", role: "owner", canManage: true },
        goal: "We want to learn why mid-market teams choose a competitor.",
        items: [],
        suggestions: [],
        dropped: [],
        steers: [],
        planning: false,
        nextRound: null,
        liveRound: null,
        timeline: [],
        report: { markdown: null, updatedAt: null },
        voices: 0,
        answers: 0,
        participants: 0,
        team: [{ userId: "u-owner", role: "owner", name: "Andrej Zukov" }],
        rewards: { currency: "USD", defaultCents: 1000, budgetCents: 50000, committedCents: 0, remainingCents: 50000, sentCents: 0, owedCents: 0, heldCount: 0, failedCount: 0, payouts: null },
      }),
    });
  });

  await page.goto("/study/new");
  await expect(page.getByTestId("study-new-page")).toBeVisible();

  // Nothing to send yet.
  await expect(page.getByTestId("study-create")).toBeDisabled();

  await page.getByTestId("study-brief-input").fill("We want to learn why mid-market teams choose a competitor over Acme, and what almost made current customers leave.");
  await page.getByTestId("study-sponsor-input").fill("Acme Projects");
  await page.getByTestId("study-reward-input").fill("10");
  await page.getByTestId("study-budget-input").fill("500");
  await page.getByTestId("study-own-questions-toggle").click();
  await page.getByTestId("study-questions-input").fill("1. What almost made you leave?\nno\n- What would have made the price increase acceptable?");

  await expect(page.getByTestId("study-create")).toBeEnabled();
  await page.getByTestId("study-create").click();

  await expect.poll(() => sent).not.toBeNull();
  expect(sent).toMatchObject({
    sponsorName: "Acme Projects",
    rewardCents: 1000,
    budgetCents: 50000,
    // List markers stripped; the two-letter line is dropped.
    questions: ["What almost made you leave?", "What would have made the price increase acceptable?"],
  });
  expect(String((sent as unknown as { brief: string }).brief)).toContain("mid-market teams");

  // Lands on the study, where the first steps are waiting.
  await expect(page).toHaveURL(new RegExp(`/study/${STUDY_ID}$`));
  await expect(page.getByTestId("study-getting-started")).toContainText("Invite the client");
  await expect(page.getByTestId("study-getting-started")).toContainText("Bring in the people to hear from");
});
