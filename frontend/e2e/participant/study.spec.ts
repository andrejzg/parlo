import { test, expect, Route } from "@playwright/test";
import { injectAudioMocks } from "../fixtures/mock-audio";
import { setupApiMocks, TEST_SURVEY, TEST_RESPONSE } from "../fixtures/mock-api";

const SURVEY_CODE = "study123";

/**
 * A research study from the participant's side (`survey.study`): the page
 * drops its group furniture, the consent screen names the sponsor and asks,
 * optionally, whether the answers may be quoted, and that choice travels
 * with the submit call. Same fixtures as the happy path, with the survey
 * marked as a sponsored study.
 */

async function openStudy(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("parlo-device-auth", JSON.stringify({ id: "parlo-device", phone: "+12345678901", verifiedAt: Date.now(), apiKey: "pk_test_key" }));
  });
  await injectAudioMocks(page);
  await setupApiMocks(page, { surveyCode: SURVEY_CODE });
  // Registered after the defaults, so it wins: the same survey, as a sponsored study.
  await page.route(`**/api/s/${SURVEY_CODE}`, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...TEST_SURVEY, study: true, sponsor: { name: "Acme Projects" }, memberCount: 9, visibility: "private" }),
    });
  });
  const submits: Record<string, unknown>[] = [];
  await page.route("**/api/responses/*/submit", async (route: Route) => {
    submits.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, id: TEST_RESPONSE.id, memberToken: null, visibility: "private" }) });
  });
  await page.goto(`/s/${SURVEY_CODE}`);
  await expect(page.getByText(TEST_SURVEY.title)).toBeVisible();
  return submits;
}

async function answerAll(page: import("@playwright/test").Page) {
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByText(`${i} / 3`)).toBeVisible();
    await expect(page.getByText(/^\d+:\d{2}$/).first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Next" }).first().click();
  }
  await expect(page.getByText("Review your answers")).toBeVisible();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  await expect(page.getByText("All done!").first()).toBeVisible({ timeout: 15000 });
}

test("a study page has no group furniture and names who hears the answers", async ({ page }) => {
  await openStudy(page);

  // Welcome: the sponsor line, and no member count.
  await expect(page.getByText(/Acme Projects hear your answers/)).toBeVisible();
  await expect(page.getByText(/in the group/)).toHaveCount(0);

  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText("Before you start")).toBeVisible();
  await expect(page.getByText(/The sponsor hears your voice but is not shown your name/)).toBeVisible();
  await expect(page.getByText(/the person who created this parlo/)).toHaveCount(0);

  // Publication consent: optional, off, the voice switch waits for the quote switch.
  const block = page.getByTestId("publish-consent");
  await expect(block).toContainText("Can we quote you?");
  await expect(page.getByTestId("publish-quote")).not.toBeChecked();
  await expect(page.getByTestId("publish-voice")).toBeDisabled();
});

test("declining to be quoted is the default and is what gets sent", async ({ page }) => {
  const submits = await openStudy(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByRole("button", { name: "I agree, start recording" }).click();
  await answerAll(page);

  expect(submits).toHaveLength(1);
  expect(submits[0].publishConsent ?? "none").toBe("none");
  // A study recruits by personal link: nothing invites the participant to pass it on.
  await expect(page.getByText("Share this parlo")).toHaveCount(0);
});

test("allowing the voice to be used travels with the answers", async ({ page }) => {
  const submits = await openStudy(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText("Before you start")).toBeVisible();

  await page.getByTestId("publish-quote").click();
  await expect(page.getByTestId("publish-voice")).toBeEnabled();
  await page.getByTestId("publish-voice").click();
  // Taking back the first takes back the second.
  await page.getByTestId("publish-quote").click();
  await expect(page.getByTestId("publish-voice")).not.toBeChecked();
  await page.getByTestId("publish-quote").click();
  await page.getByTestId("publish-voice").click();

  await page.getByRole("button", { name: "I agree, start recording" }).click();
  await answerAll(page);

  expect(submits).toHaveLength(1);
  expect(submits[0].publishConsent).toBe("voice");
});
