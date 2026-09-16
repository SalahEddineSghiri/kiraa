import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"./tests/browser",
  timeout:120000,
  retries:0,
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL??"http://127.0.0.1:8080",trace:"retain-on-failure"},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}],
});
