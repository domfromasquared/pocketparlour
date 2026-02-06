// apps/client/test/smoke.spec.ts
import { test, expect } from "@playwright/test";

test("home renders portrait UI", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await expect(page.getByText("Pick a game")).toBeVisible();
});
