import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "docker compose up --build",
    url: "http://localhost:3000/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
