import { test, expect } from "@playwright/test";

test("no scroll overflow at iPhone 17 Pro viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1206, height: 2622 });
  await page.goto("http://localhost:5173");
  await page.waitForLoadState("domcontentloaded");

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollH: doc.scrollHeight,
      clientH: doc.clientHeight,
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth
    };
  });

  expect(overflow.scrollH).toBeLessThanOrEqual(overflow.clientH);
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW);
});
