import { defineConfig } from "@playwright/test";

const developmentUrl = "http://127.0.0.1:5180/";
const previewUrl = "http://127.0.0.1:4180/stage-6/";

const desktopSizes = [
  { name: "1280×720", viewport: { width: 1280, height: 720 } },
  { name: "1920×1080", viewport: { width: 1920, height: 1080 } },
  { name: "125% (эффективный размер)", viewport: { width: 1024, height: 576 }, deviceScaleFactor: 1.25 },
  { name: "390×844", viewport: { width: 390, height: 844 } },
];

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  use: {
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  projects: [
    { name: "Chrome · dev", use: { channel: "chrome", baseURL: developmentUrl } },
    ...[["Chrome", "chrome"], ["Edge", "msedge"]].flatMap(([browser, channel]) =>
      desktopSizes.map(({ name, viewport, deviceScaleFactor }) => ({
        name: browser + " · dist · " + name,
        use: { channel, baseURL: previewUrl, viewport, deviceScaleFactor },
      }))
    ),
  ],
  webServer: [
    {
      command: "npm run dev -- --port 5180 --strictPort",
      url: developmentUrl,
      reuseExistingServer: false,
    },
    {
      command: "npm run preview -- --port 4180 --strictPort --base /stage-6/",
      url: previewUrl,
      reuseExistingServer: false,
    },
  ],
});
