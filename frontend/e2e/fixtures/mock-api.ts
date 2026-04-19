import type { Page, Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Test data constants
// ---------------------------------------------------------------------------

export const TEST_SURVEY = {
  id: "test-survey-id-001",
  title: "Customer Feedback Survey",
  status: "active",
  questions: [
    {
      id: "q1-uuid",
      survey_id: "test-survey-id-001",
      sort_order: 0,
      text: "What do you enjoy most about our product?",
      hint: "Think about features you use daily",
    },
    {
      id: "q2-uuid",
      survey_id: "test-survey-id-001",
      sort_order: 1,
      text: "What could we improve?",
      hint: "Be as specific as possible",
    },
    {
      id: "q3-uuid",
      survey_id: "test-survey-id-001",
      sort_order: 2,
      text: "Would you recommend us to a friend?",
      hint: null,
    },
  ],
  audioKeys: [
    { questionKey: "q1-uuid", audioR2Key: "surveys/test-survey-id-001/q1.webm" },
    { questionKey: "q2-uuid", audioR2Key: "surveys/test-survey-id-001/q2.webm" },
    { questionKey: "q3-uuid", audioR2Key: "surveys/test-survey-id-001/q3.webm" },
  ],
} as const;

export const TEST_RESPONSE = {
  id: "test-response-id-001",
  code: "resp1234",
  uploadUrls: {
    "q1-uuid": "https://fake-r2.example.com/upload/q1?token=abc",
    "q2-uuid": "https://fake-r2.example.com/upload/q2?token=def",
    "q3-uuid": "https://fake-r2.example.com/upload/q3?token=ghi",
  },
} as const;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ApiMockOptions {
  /** Survey code to match for GET /api/s/:code routes. Defaults to "abc123". */
  surveyCode?: string;
  /** Make presigned URL PUT uploads return a network error. */
  failUpload?: boolean;
  /** Make POST /api/surveys/:id/generate return 500. */
  failGenerate?: boolean;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Intercepts all backend API calls with deterministic mock responses.
 * Must be called before page.goto().
 */
export async function setupApiMocks(
  page: Page,
  options: ApiMockOptions = {},
) {
  const { surveyCode = "abc123", failUpload = false, failGenerate = false } =
    options;

  // GET /api/s/:code — participant survey
  await page.route(`**/api/s/${surveyCode}`, async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TEST_SURVEY),
    });
  });

  // POST /api/s/:code/responses — start response session
  await page.route(`**/api/s/${surveyCode}/responses`, async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TEST_RESPONSE),
    });
  });

  // POST /api/responses/:id/submit
  await page.route(`**/api/responses/*/submit`, async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, id: TEST_RESPONSE.id }),
    });
  });

  // POST /api/responses/:id/refresh-urls
  await page.route(
    `**/api/responses/*/refresh-urls`,
    async (route: Route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ uploadUrls: TEST_RESPONSE.uploadUrls }),
      });
    },
  );

  // POST /api/surveys/:id/generate
  await page.route(`**/api/surveys/*/generate`, async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    if (failGenerate) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "AI generation failed" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: TEST_SURVEY.title,
        questions: TEST_SURVEY.questions.map((q) => ({
          text: q.text,
          hint: q.hint,
        })),
      }),
    });
  });

  // PUT to presigned URLs (R2 uploads)
  await page.route("https://fake-r2.example.com/**", async (route: Route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    if (failUpload) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ status: 200, body: "" });
  });

  // GET /api/geo
  await page.route(`**/api/geo`, async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ country: "US" }),
    });
  });
}
