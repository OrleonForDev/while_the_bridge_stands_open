import { expect, test } from "@playwright/test";

// Coordinates from the scenario map. Clicks go through Phaser rather than the HTML controls.
const markers = {
  bus1Start: [1012, 312],
  hospital: [1250, 148],
  junction: [1012, 378],
  shelter: [286, 378],
  embankment: [1212, 676],
};

function watchPage(page, baseURL) {
  const problems = [];
  const origin = new URL(baseURL).origin;
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
      problems.push("Внешний запрос: " + url.href);
    }
  });
  page.on("requestfailed", (request) => problems.push("Ошибка загрузки: " + request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push("HTTP " + response.status() + ": " + response.url());
  });
  return problems;
}

function controls(page) {
  const vehicle = (name) => page.getByRole("button", { name, exact: true });
  const destination = (name) => page.getByRole("group", { name: /Назначить маршрут/ }).getByRole("button", { name, exact: true });
  return {
    advance: page.getByRole("button", { name: "Выполнить ход" }),
    vehicle,
    destination,
    async order(name, target) {
      await vehicle(name).click();
      await destination(target).click();
      await expect(vehicle(name)).toContainText("→ " + target);
    },
  };
}

async function clickMarker(canvas, [x, y]) {
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Карта не видна.");
  await canvas.click({ position: { x: bounds.width * x / 1740, y: bounds.height * y / 840 } });
}

test("План А от первого приказа до итога и повтора", async ({ page, baseURL }) => {
  const problems = watchPage(page, baseURL);
  const response = await page.goto("./");
  expect(response?.ok()).toBe(true);

  const canvas = page.locator("#map canvas");
  const score = page.locator("#score");
  const turn = page.locator("#turn-number");
  const { advance, vehicle, destination, order } = controls(page);
  await expect(canvas).toBeVisible();
  await expect(advance).toBeEnabled();
  expect(await canvas.evaluate((element) =>
    Boolean(element.getContext("webgl2") || element.getContext("webgl"))
  )).toBe(true);
  await expect(turn).toHaveText("1");
  await expect(score).toHaveText("0 / 108");
  await expect(page.getByText("Водосброс закрыт", { exact: true })).toBeVisible();

  await vehicle("Паром").click();
  await clickMarker(canvas, markers.bus1Start);
  await expect(vehicle("Автобус А1")).toHaveAttribute("aria-pressed", "true");
  await clickMarker(canvas, markers.hospital);
  await expect(vehicle("Автобус А1")).toContainText("→ Больница");
  await order("Автобус А2", "Развязка");
  await order("Паром", "Набережная");
  await advance.click();
  await expect(turn).toHaveText("2");
  await expect(score).toHaveText("0 / 108");
  await expect(vehicle("Автобус А2")).toContainText("18/18 мест занято");

  await vehicle("Автобус А1").click();
  const wide = await canvas.boundingBox();
  await page.setViewportSize({ width: 700, height: 820 });
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeLessThan(wide.width);
  await clickMarker(canvas, markers.junction);
  await expect(vehicle("Автобус А1")).toContainText("→ Развязка");
  await order("Автобус А2", "Убежище");
  await order("Паром", "Убежище");
  await advance.click();
  await expect(turn).toHaveText("3");
  await expect(score).toHaveText("36 / 108");

  await vehicle("Автобус А1").focus();
  await page.keyboard.press("Enter");
  await destination("Убежище").focus();
  await page.keyboard.press("Enter");
  await expect(vehicle("Автобус А1")).toContainText("→ Убежище");
  await order("Паром", "Набережная");
  await advance.click();
  await expect(turn).toHaveText("4");
  await expect(score).toHaveText("54 / 108");
  await expect(page.getByText("Нижняя дорога · закрыт", { exact: true })).toBeVisible();

  await vehicle("Паром").click();
  await clickMarker(canvas, markers.shelter);
  await expect(vehicle("Паром")).toContainText("→ Убежище");
  await advance.click();
  await expect(turn).toHaveText("5");
  await expect(score).toHaveText("72 / 108");
  await expect(page.getByText("Мост · закрыт", { exact: true })).toBeVisible();
  await vehicle("Автобус А1").click();
  await expect(destination("Развязка")).toBeHidden();

  await order("Паром", "Набережная");
  await advance.click();
  await expect(turn).toHaveText("6");
  await expect(score).toHaveText("72 / 108");
  await clickMarker(canvas, markers.shelter);
  await expect(vehicle("Паром")).toContainText("→ Убежище");
  await advance.click();

  const results = page.getByRole("region", { name: "Итоги эвакуации" });
  await expect(results).toBeVisible();
  await expect(results.getByText("Вывезено 90 из 108")).toBeVisible();
  await expect(results.getByText("Мост и паромная переправа закрыты.")).toBeVisible();
  await expect(page.getByText("Переправа · закрытие перед ходом 7")).toBeVisible();
  await expect(turn).toHaveText("7");
  await expect(advance).toBeHidden();
  for (const [district, values] of [["Больница", ["18", "18", "0"]], ["Школа", ["18", "0", "0"]], ["Набережная", ["54", "0", "0"]]]) {
    const row = results.getByRole("row", { name: new RegExp(district) });
    await expect(row.getByRole("cell")).toHaveText(values);
  }

  await results.getByRole("button", { name: "Повторить" }).click();
  await expect(results).toBeHidden();
  await expect(turn).toHaveText("1");
  await expect(score).toHaveText("0 / 108");
  await expect(page.locator("#journal > li")).toHaveCount(0);
  await expect(page.getByText("Мост · последний ход 4", { exact: true })).toBeVisible();
  await expect(vehicle("Автобус А1")).toContainText("Развязка · 0/18 мест занято");
  await expect(vehicle("Автобус А2")).toContainText("Школа · 0/18 мест занято");
  await expect(vehicle("Паром")).toContainText("Убежище · 0/18 мест занято");
  await expect(advance).toBeEnabled();

  if (new URL(baseURL).pathname !== "/") {
    await expect(page.locator("script[type=module][src]")).toHaveAttribute("src", /^\.\/assets\//);
  }
  expect(problems).toEqual([]);
});

test("Встречные автобусы блокируют ход, приказ можно снять", async ({ page }) => {
  await page.goto("./");
  const { advance, vehicle, destination, order } = controls(page);
  await order("Автобус А1", "Убежище");
  await order("Автобус А2", "Развязка");
  await advance.dblclick();
  await expect(page.locator("#turn-number")).toHaveText("2");
  await order("Автобус А1", "Развязка");
  await order("Автобус А2", "Убежище");
  await expect(advance).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("На мосту два приказа");
  await expect(vehicle("Автобус А1")).toContainText("конфликт на мосту");
  await expect(vehicle("Автобус А2")).toContainText("конфликт на мосту");
  await expect(page.locator("#score")).toHaveText("0 / 108");
  await vehicle("Автобус А1").click();
  await destination("Ждать").click();
  await expect(advance).toBeEnabled();
  await advance.click();
  await expect(page.locator("#score")).toHaveText("18 / 108");
});
