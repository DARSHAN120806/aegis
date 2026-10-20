import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", headless: true },
  expect: { timeout: 10000 },
  timeout: 60000,
});
