import { defineConfig } from "@playwright/test";

const developmentUrl = "http://127.0.0.1:5180/";
const previewUrl = "http://127.0.0.1:4180/stage-5/";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  use: {
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  projects: [
    { name: "Chrome · dev", use: { channel: "chrome", baseURL: developmentUrl } },
    { name: "Chrome · dist", use: { channel: "chrome", baseURL: previewUrl } },
    { name: "Edge · dist", use: { channel: "msedge", baseURL: previewUrl } },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 5180 --strictPort",
      url: developmentUrl,
      reuseExistingServer: false,
    },
    {
      command: "npm run preview -- --port 4180 --strictPort --base /stage-5/",
      url: previewUrl,
      reuseExistingServer: false,
    },
  ],
});
