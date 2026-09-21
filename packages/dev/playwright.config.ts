import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser", workers: 1, timeout: 90000,
  use: { channel: process.env.COMPONENTONCE_BROWSER_CHANNEL ?? "chrome", headless: true, viewport: { width: 1600, height: 1000 } },
  outputDir: "../../.artifacts/dev/playwright", reporter: "list",
});
