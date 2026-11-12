import { expect, test } from "@playwright/test";

test("узлы выбираются на карте после изменения размера и с клавиатуры", async ({ page, baseURL }) => {
  const problems = [];
  const origin = new URL(baseURL).origin;
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
      problems.push(`Внешний запрос: ${url.href}`);
    }
  });
  page.on("requestfailed", (request) => {
    problems.push(`Ошибка загрузки: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  const response = await page.goto("./");
  expect(response?.ok()).toBe(true);

  const canvas = page.locator("#map canvas");
  const status = page.getByRole("status");
  const shelter = page.getByRole("button", { name: "Убежище", exact: true });
  const junction = page.getByRole("button", { name: "Развязка", exact: true });

  await expect(canvas).toBeVisible();
  await expect(status).toHaveText("Узел не выбран");
  expect(await canvas.evaluate((element) =>
    Boolean(element.getContext("webgl2") || element.getContext("webgl"))
  )).toBe(true);

  const initialBounds = await canvas.boundingBox();
  expect(initialBounds?.width).toBeGreaterThan(850);

  async function clickNode(xFraction) {
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Карта не видна.");
    await page.mouse.click(bounds.x + bounds.width * xFraction, bounds.y + bounds.height * 0.474);
  }

  await clickNode(0.245);
  await expect(status).toHaveText("Выбран узел: Убежище");
  await expect(shelter).toHaveAttribute("aria-pressed", "true");
  await expect(junction).toHaveAttribute("aria-pressed", "false");

  await clickNode(0.755);
  await expect(status).toHaveText("Выбран узел: Развязка");
  await expect(shelter).toHaveAttribute("aria-pressed", "false");

  await page.setViewportSize({ width: 720, height: 680 });
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeLessThan(720);
  await clickNode(0.245);
  await expect(status).toHaveText("Выбран узел: Убежище");
  await clickNode(0.755);
  await expect(status).toHaveText("Выбран узел: Развязка");

  await shelter.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Выбран узел: Убежище");
  await expect(shelter).toHaveAttribute("aria-pressed", "true");
  await expect(junction).toHaveAttribute("aria-pressed", "false");

  if (new URL(baseURL).pathname === "/stage-0/") {
    await expect(page.locator("script[type=module][src]")).toHaveAttribute("src", /^\.\/assets\//);
  }
  expect(problems).toEqual([]);
});
