import { test, expect } from "@playwright/test";
import { injectAudioMocks } from "../fixtures/mock-audio";
import { setupApiMocks, TEST_SURVEY } from "../fixtures/mock-api";

const SURVEY_CODE = "test123";

/**
 * Pre-seed the `parlo-device-auth` localStorage key so the participant flow
 * skips phone + OTP entirely and goes review → submit → done. The current
 * participant flow no longer has first-name / last-name screens; phone auth
 * goes through Firebase + reCAPTCHA which can't run reliably in headless
 * Chromium. Rather than mock Firebase, we use the existing "returning device"
 * short-circuit already wired into ParticipantPage.
 *
 * Must be called BEFORE page.goto() — uses addInitScript so the value is
 * present when the app boots.
 */
async function seedDeviceAuth(
  page: import("@playwright/test").Page,
  phone = "+12345678901",
) {
  await page.addInitScript(
    ([phoneValue]) => {
      try {
        localStorage.setItem(
          "parlo-device-auth",
          JSON.stringify({
            id: "parlo-device",
            phone: phoneValue,
            verifiedAt: Date.now(),
          }),
        );
      } catch {
        // localStorage unavailable (private mode etc.) — tests will fall
        // through to the real phone+OTP flow, which will fail visibly.
      }
    },
    [phone],
  );
}

/** Wait for recording to start and fake-record for a bit, then tap Next */
async function recordAndNext(page: import("@playwright/test").Page) {
  // Wait for recording timer badge
  await expect(page.getByText(/^\d+:\d{2}$/).first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Next" }).first().click();
}

/** Continue from Review → submit → assert Thank You screen visible */
async function finishAndAssertDone(page: import("@playwright/test").Page) {
  await expect(page.getByText("Review your answers")).toBeVisible();
  await page.getByRole("button", { name: "Looks good, continue" }).click();
  // With deviceAuth pre-seeded, the flow skips phone + OTP and lands on Thank You.
  await expect(page.getByText("All done!").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Share this survey")).toBeVisible({ timeout: 5000 });
}

test.describe("Participant happy path", () => {
  test("participant completes full survey flow", async ({ page }) => {
    await seedDeviceAuth(page);
    await injectAudioMocks(page);
    await setupApiMocks(page, { surveyCode: SURVEY_CODE });

    await page.goto(`/s/${SURVEY_CODE}`);

    // Welcome
    await expect(page.getByText(TEST_SURVEY.title)).toBeVisible();
    await page.getByRole("button", { name: "Start recording" }).click();

    // Consent
    await expect(page.getByText("Before you start")).toBeVisible();
    await page.getByRole("button", { name: "I agree, start recording" }).click();

    // Questions 1-3
    for (let i = 1; i <= 3; i++) {
      await expect(page.getByText(`${i} / 3`)).toBeVisible();
      await recordAndNext(page);
    }

    await finishAndAssertDone(page);
  });

  test("participant uses text mode", async ({ page }) => {
    await seedDeviceAuth(page);
    await injectAudioMocks(page, { denyPermission: true });
    await setupApiMocks(page, { surveyCode: SURVEY_CODE });

    await page.goto(`/s/${SURVEY_CODE}`);

    // Welcome + Consent
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByRole("button", { name: "I agree, start recording" }).click();

    // Questions 1-3 in text mode
    for (let i = 1; i <= 3; i++) {
      await expect(page.getByText(`${i} / 3`)).toBeVisible();
      if (i === 1) {
        await expect(page.getByText("Mic unavailable")).toBeVisible({ timeout: 5000 });
      }
      // Wait for the specific question text to confirm transition is done
      await expect(page.getByText(TEST_SURVEY.questions[i - 1].text).first()).toBeVisible();
      const textarea = page.getByPlaceholder("Type your answer...");
      await expect(textarea).toBeVisible();
      // Clear and fill — the textarea might have stale value from transition
      await textarea.click();
      await textarea.fill(`Text answer ${i}`);
      // Wait for Next to become enabled (canSubmit depends on textValue)
      await expect(page.getByRole("button", { name: "Next" }).first()).toBeEnabled({ timeout: 3000 });
      await page.getByRole("button", { name: "Next" }).first().click();
    }

    await finishAndAssertDone(page);
  });

  test("session restores after page refresh", async ({ page }) => {
    test.slow();

    await seedDeviceAuth(page);
    await injectAudioMocks(page);
    await setupApiMocks(page, { surveyCode: SURVEY_CODE });

    await page.goto(`/s/${SURVEY_CODE}`);

    // Welcome + Consent
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByRole("button", { name: "I agree, start recording" }).click();

    // Answer Questions 1 and 2
    for (let i = 1; i <= 2; i++) {
      await expect(page.getByText(`${i} / 3`)).toBeVisible();
      await recordAndNext(page);
    }

    // Should be on question 3
    await expect(page.getByText("3 / 3")).toBeVisible();

    // Re-inject mocks. addInitScript (seedDeviceAuth, injectAudioMocks) persists
    // through reload, but route mocks do not.
    await setupApiMocks(page, { surveyCode: SURVEY_CODE });
    await page.reload();

    // Verify session restored
    await expect(page.getByText("Session restored")).toBeVisible({ timeout: 10000 });

    // Should resume — may be at question 3 or review depending on timing
    const isOnQuestion3 = await page.getByText("3 / 3").isVisible().catch(() => false);
    const isOnReview = await page.getByText("Review your answers").isVisible().catch(() => false);

    if (isOnQuestion3) {
      await recordAndNext(page);
    }

    if (isOnQuestion3 || isOnReview) {
      await finishAndAssertDone(page);
    }
  });
});
