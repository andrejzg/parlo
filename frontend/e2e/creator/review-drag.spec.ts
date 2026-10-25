import { test, expect, devices, chromium, type Page, type Route } from "@playwright/test";
import fs from "fs";
import path from "path";
import { injectAudioMocks } from "../fixtures/mock-audio";

/**
 * Dragging a review card into the list's edge zone scrolls the list
 * (`useDragAutoScroll`), the card stays under the pointer while it does,
 * the cards it passes settle into their slots, and the order changes.
 * A nine-question draft so the list overflows an iPhone SE.
 */
const DRAFT = Array.from({ length: 9 }, (_, i) => ({ text: `Question number ${i + 1} about the offsite plan, long enough to wrap onto two lines on a phone`, hint: `Question ${i + 1} of 9`, type: "voice" as const }));

test("dragging a review card near the edge scrolls the list", async () => {
  test.setTimeout(60_000);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone SE"], hasTouch: false, isMobile: false, viewport: { width: 375, height: 667 } });
  const page: Page = await context.newPage();
  await page.route("**/api/surveys", async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "s1", code: "abc123", dashboardCode: "dash12345678", apiKey: "pk_test", uploadUrls: { brief: "https://example.com/u", audience: "https://example.com/a", gather: "https://example.com/g" } }) });
  });
  await page.route("**/api/surveys/*/generate", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "T", brief: "b", questions: DRAFT }) });
  });
  await injectAudioMocks(page);
  await page.goto("http://localhost:5173/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /create a parlo/i }).click();
  await page.locator('[data-testid="shape-card"][data-shape="feedback"]').click();
  await page.getByTestId("topic-continue").click();
  await page.getByTestId("outputs-build").click();
  await page.getByText("Review your").waitFor({ timeout: 20_000 });
  await page.getByText(DRAFT[0].text).waitFor();
  await page.waitForTimeout(800);

  const list = page.getByTestId("review-list");
  const listBox = (await list.boundingBox())!;
  const rail = page.getByTestId("review-drag-rail").first();
  const railBox = (await rail.boundingBox())!;
  const card = page.locator("li", { hasText: DRAFT[0].text }).first();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);

  const startX = railBox.x + railBox.width / 2;
  const startY = railBox.y + railBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Into the bottom edge zone, in steps so Framer registers the drag.
  const edgeY = listBox.y + listBox.height - 30;
  for (let y = startY; y < edgeY; y += 40) await page.mouse.move(startX, y);
  await page.mouse.move(startX, edgeY);
  await page.waitForTimeout(1200);
  const scrollTop = await list.evaluate((el) => el.scrollTop);
  const cardBox = (await card.boundingBox())!;
  expect(scrollTop).toBeGreaterThan(100);
  // The card is still under the pointer.
  expect(cardBox.y).toBeLessThan(edgeY);
  expect(cardBox.y + cardBox.height).toBeGreaterThan(edgeY);
  const OUT = path.join(process.env.PARLO_SHOTS_DIR ?? "/tmp", "parlo-creator-iphone-se");
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/10-drag-hold.png` });
  // The dragged card and at least one sibling intersect the list: the slot above the card is not left empty.
  const inView = await page.locator('[data-testid="review-drag-rail"]').evaluateAll((rails, box) =>
    rails.filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.y + 10 && b.top < box.y + box.height - 10; }).length, { y: listBox.y, height: listBox.height });
  expect(inView).toBeGreaterThanOrEqual(2);
  await page.mouse.move(startX, edgeY - 200);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(600);
  const texts = await page.locator('[data-testid="review-drag-rail"]').evaluateAll((rails) => rails.map((r) => r.parentElement!.textContent!.slice(0, 20)));
  expect(texts[0]).not.toContain("number 1 ");
  await browser.close();
});
