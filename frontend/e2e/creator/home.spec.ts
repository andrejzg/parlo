import { test, expect, chromium, devices, Route, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:5173";
const OUT_ROOT = process.env.PARLO_SHOTS_DIR ?? "/tmp";

/**
 * The home screen as a chat inbox: one list, what needs you pinned on top
 * (approve a proposed round, answer a probe), then newest activity, drafts
 * last. Each row previews what last happened, carries faces, and shows a
 * chat-style time. Runs logged in (device auth in localStorage) with
 * /api/my/surveys and the LinkedIn profile stubbed, on three phone sizes.
 * Screenshots land in $PARLO_SHOTS_DIR/parlo-home-<device>/.
 */

const DEVICES = ["iPhone SE", "Pixel 7", "iPhone 15 Pro Max"] as const;

const H = 3_600_000;
const D = 24 * H;

function face(userId: string, name: string | null, photo: boolean) {
  return { userId, name, photoUrl: photo ? `https://api.example.test/api/users/${userId}/photo` : null };
}

function surveysFixture(now: number) {
  const iso = (t: number) => new Date(t).toISOString();
  const base = {
    status: "active",
    visibility: "private",
    memberToken: "tok",
    newCount: 0,
    latestResponseAt: null as string | null,
    reportUpdatedAt: null as string | null,
    reportPreview: null as string | null,
    round: null as unknown,
    proposedRound: null as unknown,
    pendingAsks: 0,
    faces: [] as ReturnType<typeof face>[],
  };
  return [
    {
      ...base,
      id: "s-midnight",
      code: "midnight",
      dashboardCode: "midnightdash",
      title: "Midnight Mindset: What Keeps Founders Awake at 3am",
      role: "owner",
      createdAt: iso(now - 9 * D),
      questionCount: 4,
      memberCount: 8,
      responseCount: 9,
      newCount: 2,
      latestResponseAt: iso(now - 5 * H),
      reportUpdatedAt: iso(now - 4 * H),
      reportPreview: "Most founders say the hardest part is not knowing whether the silence means no.",
      round: { number: 2, kind: "poll", sentAt: iso(now - 2 * D), answered: 5, targets: 7 },
      proposedRound: { number: 3, kind: "probe", createdAt: iso(now - 2 * H - 60_000) },
      lastActivityAt: iso(now - 2 * H - 60_000),
      faces: [face("u1", "Priya Natarajan", true), face("u2", "Tom Okafor", true), face("u3", "Lena Fischer", false)],
    },
    {
      ...base,
      id: "s-lunch",
      code: "lunch",
      dashboardCode: "",
      title: "Lunch club",
      role: "member",
      createdAt: iso(now - 20 * D),
      questionCount: 3,
      memberCount: 6,
      responseCount: 0,
      round: { number: 2, kind: "probe", sentAt: iso(now - 26 * H), answered: 1, targets: 3 },
      pendingAsks: 1,
      lastActivityAt: iso(now - 26 * H),
      faces: [face("u4", "Sam Lee", true), face("u5", "Ada", false), face("u6", "Noor Haddad", true)],
    },
    {
      ...base,
      id: "s-thoughts",
      code: "thoughts",
      dashboardCode: "thoughtsdash",
      title: "Share Your Thoughts",
      role: "owner",
      createdAt: iso(now - 6 * D),
      questionCount: 3,
      memberCount: 4,
      responseCount: 3,
      newCount: 3,
      latestResponseAt: iso(now - 25 * 60_000),
      round: { number: 1, kind: "poll", sentAt: iso(now - 6 * D), answered: 3, targets: 0 },
      lastActivityAt: iso(now - 25 * 60_000),
      faces: [face("u7", "Jonas Berg", true), face("u8", "Maya Chen", true)],
    },
    {
      ...base,
      id: "s-catchup",
      code: "catchup",
      dashboardCode: "catchupdash",
      title: "Catchup Survey",
      role: "admin",
      createdAt: iso(now - 30 * D),
      questionCount: 2,
      memberCount: 5,
      responseCount: 4,
      latestResponseAt: iso(now - 3 * D),
      round: { number: 2, kind: "poll", sentAt: iso(now - 4 * D), answered: 4, targets: 4 },
      lastActivityAt: iso(now - 3 * D),
      faces: [face("u9", "Rosa Delgado", false)],
    },
    {
      ...base,
      id: "s-book",
      code: "book",
      dashboardCode: "",
      title: "Book club",
      role: "member",
      createdAt: iso(now - 40 * D),
      questionCount: 2,
      memberCount: 9,
      responseCount: 0,
      reportUpdatedAt: iso(now - 5 * D),
      reportPreview: "Three people want the next book to be non-fiction.",
      round: { number: 1, kind: "poll", sentAt: iso(now - 40 * D), answered: 8, targets: 0 },
      lastActivityAt: iso(now - 5 * D),
      faces: [face("u10", "Ibrahim Sow", true), face("u11", "Kate Murphy", true), face("u12", "Yuki Tanaka", true)],
    },
    {
      ...base,
      id: "s-founder",
      code: "founder",
      dashboardCode: "founderdash",
      title: "Founder Feedback",
      role: "owner",
      createdAt: iso(now - 183 * D),
      questionCount: 2,
      memberCount: 1,
      responseCount: 0,
      round: { number: 1, kind: "poll", sentAt: iso(now - 183 * D), answered: 0, targets: 0 },
      lastActivityAt: iso(now - 183 * D),
    },
    {
      ...base,
      id: "s-draft",
      code: "draft1",
      dashboardCode: "draftdash",
      title: null,
      role: "owner",
      createdAt: iso(now - 1 * D),
      questionCount: 0,
      memberCount: 1,
      responseCount: 0,
      lastActivityAt: iso(now - 1 * D),
    },
  ];
}

/** A flat avatar glyph, coloured by the URL, served as SVG. */
function avatarSvg(url: string): string {
  let h = 0;
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 45% 45%)"/><circle cx="32" cy="24" r="12" fill="#fff" opacity=".9"/><ellipse cx="32" cy="56" rx="20" ry="14" fill="#fff" opacity=".9"/></svg>`;
}

async function mockHomeApi(page: Page) {
  await page.route("**/api/my/surveys", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ surveys: surveysFixture(Date.now()) }),
    });
  });
  await page.route("**/api/auth/linkedin/profile*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: true, name: "Andrej Zukov Gregoric", photoUrl: "https://api.example.test/me.svg" }),
    });
  });
  await page.route("https://api.example.test/**", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: avatarSvg(route.request().url()) });
  });
  await page.route("**/api/d/**", async (route: Route) => route.abort());
}

for (const deviceName of DEVICES) {
  test(`home list on ${deviceName}`, async () => {
    test.setTimeout(60_000);
    const OUT = path.join(OUT_ROOT, `parlo-home-${deviceName.toLowerCase().replace(/\s+/g, "-")}`);
    fs.mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch();
    const context = await browser.newContext({ ...devices[deviceName] });
    await context.addInitScript(() => {
      localStorage.setItem(
        "parlo-device-auth",
        JSON.stringify({ id: "parlo-device", phone: "+447700900123", verifiedAt: Date.now(), apiKey: "pk_test_key" })
      );
    });
    const page = await context.newPage();
    await mockHomeApi(page);

    await page.goto(BASE_URL);

    const rows = page.getByTestId("parlo-row");
    await expect(rows).toHaveCount(7, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Hey, Andrej" })).toBeVisible();
    await expect(page.getByText(/total responses/)).toHaveCount(0);

    // Pinned: the owner's approval first, then the member's probe, both newest-first.
    await expect(rows.nth(0)).toContainText("Midnight Mindset");
    await expect(rows.nth(0)).toHaveAttribute("data-action", "approve");
    await expect(rows.nth(0)).toContainText("Agent proposed round 3");
    await expect(rows.nth(0)).toContainText("Approve");
    await expect(rows.nth(0).locator("time")).toHaveText(/^(2h|Yesterday)$/);
    await expect(rows.nth(0).locator("img")).toHaveCount(2);

    await expect(rows.nth(1)).toContainText("Lunch club");
    await expect(rows.nth(1)).toHaveAttribute("data-action", "answer");
    await expect(rows.nth(1)).toContainText(/the agent has a question for you/i);
    await expect(rows.nth(1)).toContainText("member");
    await expect(rows.nth(1).locator("time")).toHaveText(/^(Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);

    // Then by recency: unread answers, a finished round, the agent's report, a parlo nobody answered.
    await expect(rows.nth(2)).toContainText("Share Your Thoughts");
    await expect(rows.nth(2)).toHaveAttribute("data-unread", "true");
    await expect(rows.nth(2)).toContainText("3 new answers");
    await expect(rows.nth(2).locator("time")).toHaveText("25m");

    await expect(rows.nth(3)).toContainText("Catchup Survey");
    await expect(rows.nth(3)).toContainText("admin");
    await expect(rows.nth(3)).toContainText("Everyone answered round 2");
    await expect(rows.nth(3).locator("time")).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);

    await expect(rows.nth(4)).toContainText("Book club");
    await expect(rows.nth(4)).toContainText("Agent: Three people want the next book");

    await expect(rows.nth(5)).toContainText("Founder Feedback");
    await expect(rows.nth(5)).toContainText("Share the link to get the first answers");
    await expect(rows.nth(5).locator("time")).toHaveText(/^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/);

    // Drafts last, muted.
    await expect(rows.nth(6)).toContainText("Untitled parlo");
    await expect(rows.nth(6)).toContainText("Continue setting up");

    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/01-home.png` });
    await page.screenshot({ path: `${OUT}/02-home-full.png`, fullPage: true });

    // A pending approval opens the dashboard straight on the Agent tab.
    await rows.nth(0).click();
    await page.waitForURL(/\/d\/midnightdash\?tab=agent$/, { timeout: 10_000 });

    await browser.close();
  });
}
