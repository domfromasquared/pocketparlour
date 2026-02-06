// apps/client/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  webServer: {
    command: "pnpm dev",
    port: 5173,
    reuseExistingServer: true
  },
  testDir: "test",
  use: { viewport: { width: 390, height: 844 } }
});
