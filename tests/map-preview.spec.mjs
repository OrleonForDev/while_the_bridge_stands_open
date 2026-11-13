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
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const response = await page.goto("./");
  expect(response?.ok()).toBe(true);

  const canvas = page.locator("#map canvas");
  const score = page.locator("#score");
  const turn = page.locator("#turn-number");
  const { advance, vehicle, destination, order } = controls(page);
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: "Звуки игры" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => document.fonts.check('700 38px "Bridge Inter"', "Убежище"))).toBe(true);
  await expect(advance).toBeEnabled();
  expect(await canvas.evaluate((element) =>
    Boolean(element.getContext("webgl2") || element.getContext("webgl"))
  )).toBe(true);
  await expect(turn).toHaveText("1");
  await expect(page.locator("#turn-guide")).toContainText("забирает до 18 человек перед выездом");
  await expect(page.locator("#turn-feedback")).toBeEmpty();
  const help = page.getByText("Как играть", { exact: true });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/За ход каждая машина проезжает один участок/)).toBeVisible();
  await expect(page.getByText(/После последнего доступного хода маршрут закроется/)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(score).toHaveText("0 / 108");
  await expect(page.getByRole("table", { name: "Последний доступный ход" }).getByRole("row", { name: /Закрыт/ }).getByRole("cell")).toHaveText(["4", "6"]);
  await expect(page.getByRole("table", { name: "Последний доступный ход" }).getByRole("row", { name: /Открыт/ }).getByRole("cell")).toHaveText(["7", "4"]);
  await expect(page.getByRole("radio", { name: "Оставить закрытым" })).toBeHidden();

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
  await expect(page.locator("#turn-feedback")).toContainText("Ход 1 выполнен. Посадка: 18 чел. Доставлено в убежище: 0 чел.");
  await expect(page.locator("#turn-guide")).toContainText("Через мост за ход проезжает один автобус.");

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
  await expect(page.locator("#turn-feedback")).toContainText("Доставлено в убежище: 36 чел.");
  await expect(page.locator("#turn-guide")).toContainText("раньше закрывает паромную переправу");

  await vehicle("Автобус А1").focus();
  await page.keyboard.press("Enter");
  await destination("Убежище").focus();
  await page.keyboard.press("Enter");
  await expect(vehicle("Автобус А1")).toContainText("→ Убежище");
  await order("Паром", "Набережная");
  await expect(advance).toBeDisabled();
  const keepClosed = page.getByRole("radio", { name: "Оставить закрытым" });
  await expect(keepClosed).not.toBeChecked();
  await keepClosed.check();
  await advance.click();
  await expect(turn).toHaveText("4");
  await expect(keepClosed).toBeHidden();
  await expect(score).toHaveText("54 / 108");
  await expect(page.getByText("Нижняя дорога · закрыт", { exact: true })).toBeVisible();

  await vehicle("Паром").click();
  await clickMarker(canvas, markers.shelter);
  await expect(vehicle("Паром")).toContainText("→ Убежище");
  await advance.click();
  await expect(turn).toHaveText("5");
  await expect(score).toHaveText("72 / 108");
  await expect(page.getByText("Мост · закрыт", { exact: true })).toBeVisible();
  await expect(page.locator("#turn-feedback")).toContainText("С хода 5 проезд закрыт: мост.");
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
  await expect(results.locator(".icon-rotate")).toHaveCSS("mask-image", /assets\/tabler\/rotate\.svg/);
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
  await expect(page.locator("#turn-guide")).toContainText("забирает до 18 человек перед выездом");
  await expect(page.locator("#turn-feedback")).toBeEmpty();
  await expect(score).toHaveText("0 / 108");
  await expect(page.locator("#journal > li")).toHaveCount(0);
  await expect(page.locator("#turn-feedback")).toBeEmpty();
  await expect(page.getByText("Мост · последний ход 4", { exact: true })).toBeVisible();
  await expect(vehicle("Автобус А1")).toContainText("Развязка · 0/18 мест занято");
  await expect(vehicle("Автобус А2")).toContainText("Школа · 0/18 мест занято");
  await expect(vehicle("Паром")).toContainText("Убежище · 0/18 мест занято");
  await expect(advance).toBeEnabled();

  if (new URL(baseURL).pathname !== "/") {
    await expect(page.locator("script[type=module][src]")).toHaveAttribute("src", /^\.\/assets\//);
  }
  expect(requests).toEqual(expect.arrayContaining([
    expect.stringMatching(/\/assets\/tabler\/bus\.svg$/),
    expect.stringMatching(/\/assets\/tabler\/ship\.svg$/),
    expect.stringMatching(/\/assets\/tabler\/rotate\.svg$/),
    expect.stringMatching(/\/assets\/inter\/InterVariable\.woff2$/),
  ]));
  expect(requests.some((path) => path.endsWith(".ogg"))).toBe(false);
  expect(problems).toEqual([]);
});

test("План Б: прогноз можно менять до подтверждения, затем действует открытый водосброс", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const turn = page.locator("#turn-number");
  const score = page.locator("#score");
  const { advance, vehicle, destination, order } = controls(page);
  const keepClosed = page.getByRole("radio", { name: "Оставить закрытым" });
  const open = page.getByRole("radio", { name: "Открыть водосброс" });
  const forecasts = page.getByRole("table", { name: "Последний доступный ход" });

  await order("Автобус А1", "Больница");
  await order("Автобус А2", "Развязка");
  await order("Паром", "Набережная");
  await advance.click();
  await order("Автобус А1", "Развязка");
  await order("Автобус А2", "Убежище");
  await order("Паром", "Убежище");
  await advance.click();
  await expect(turn).toHaveText("3");
  await expect(advance).toBeDisabled();
  await expect(open).not.toBeChecked();
  await expect(page.locator("#order-status")).toContainText("выбери режим водосброса");
  await order("Автобус А1", "Убежище");
  await order("Паром", "Набережная");
  const before = await page.locator("#vehicles").innerText();
  const journalBefore = await page.locator("#journal").innerText();

  await open.focus();
  await page.keyboard.press("Space");
  await expect(open).toBeChecked();
  await expect(advance).toBeEnabled();
  await expect(page.getByText("Мост · последний ход 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Переправа · последний ход 4", { exact: true })).toBeVisible();
  await expect(page.getByText("Нижняя дорога · последний ход 3", { exact: true })).toBeVisible();
  await keepClosed.check();
  await expect(page.getByText("Мост · последний ход 4", { exact: true })).toBeVisible();
  await expect(page.getByText("Переправа · последний ход 6", { exact: true })).toBeVisible();
  await open.check();
  await expect(turn).toHaveText("3");
  await expect(score).toHaveText("36 / 108");
  await expect(page.locator("#turn-feedback")).toContainText("Доставлено в убежище: 36 чел.");
  await expect(page.locator("#turn-guide")).toContainText("раньше закрывает паромную переправу");
  await expect(page.locator("#vehicles")).toHaveText(before, { useInnerText: true });
  await expect(page.locator("#journal")).toHaveText(journalBefore, { useInnerText: true });

  await advance.click();
  await expect(turn).toHaveText("4");
  await expect(score).toHaveText("54 / 108");
  await expect(open).toBeHidden();
  await expect(forecasts.getByRole("row", { name: /Открыт · выбран/ })).toBeVisible();
  await expect(page.getByText("Водосброс открыт.", { exact: true })).toBeVisible();
  await expect(page.getByText("Нижняя дорога · закрыт", { exact: true })).toBeVisible();

  await order("Автобус А1", "Развязка");
  await order("Паром", "Убежище");
  await advance.click();
  await expect(turn).toHaveText("5");
  await expect(score).toHaveText("72 / 108");
  await expect(vehicle("Автобус А1")).toContainText("Развязка");
  await expect(page.getByText("Переправа · закрыт", { exact: true })).toBeVisible();
  await expect(page.locator("#turn-feedback")).toContainText("С хода 5 проезд закрыт: переправа.");
  await expect(destination("Набережная")).toBeHidden();

  await order("Автобус А1", "Больница");
  await advance.click();
  await expect(turn).toHaveText("6");
  await order("Автобус А1", "Развязка");
  await advance.click();
  await expect(turn).toHaveText("7");
  await expect(score).toHaveText("72 / 108");
  await expect(vehicle("Автобус А1")).toContainText("18/18 мест занято");
  await order("Автобус А1", "Убежище");
  await expect(page.locator("#turn-guide")).toHaveText("Последний ход для проезда: мост.");
  await advance.click();

  const results = page.getByRole("region", { name: "Итоги эвакуации" });
  await expect(turn).toHaveText("8");
  await expect(results.getByText("Вывезено 90 из 108")).toBeVisible();
  await expect(page.getByText("Мост · закрытие перед ходом 8", { exact: true })).toBeVisible();
  await expect(page.locator("#turn-feedback")).toContainText("Ход 7 выполнен. Посадка: 0 чел. Доставлено в убежище: 18 чел.");
  for (const [district, values] of [["Больница", ["36", "0", "0"]], ["Школа", ["18", "0", "0"]], ["Набережная", ["36", "18", "0"]]]) {
    await expect(results.getByRole("row", { name: new RegExp(district) }).getByRole("cell")).toHaveText(values);
  }
  await results.getByRole("button", { name: "Повторить" }).click();
  await expect(score).toHaveText("0 / 108");
  await expect(forecasts.getByRole("row", { name: /выбран/ })).toHaveCount(0);
  await expect(page.locator("#journal > li")).toHaveCount(0);
  await expect(page.locator("#turn-feedback")).toBeEmpty();
  await advance.click();
  await advance.click();
  await expect(turn).toHaveText("3");
  await expect(open).not.toBeChecked();
  await expect(keepClosed).not.toBeChecked();
  await expect(advance).toBeDisabled();
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
  await expect(page.locator("#order-status")).toContainText("На мосту два приказа");
  await expect(vehicle("Автобус А1")).toContainText("конфликт на мосту");
  await expect(vehicle("Автобус А2")).toContainText("конфликт на мосту");
  await expect(page.locator("#score")).toHaveText("0 / 108");
  await vehicle("Автобус А1").click();
  await destination("Ждать").click();
  await expect(advance).toBeEnabled();
  await advance.click();
  await expect(page.locator("#score")).toHaveText("18 / 108");
});

test("Ассеты и лицензии доступны локально, звук включается и отключается", async ({ page, baseURL }) => {
  const problems = watchPage(page, baseURL);
  await page.addInitScript(() => {
    window.playedCues = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function () {
      await play.call(this);
      window.playedCues.push(this.currentSrc.split("/").at(-1));
    };
  });
  await page.goto("./");
  const { advance, destination } = controls(page);
  const sound = page.getByRole("button", { name: "Звуки игры" });
  const cues = () => page.evaluate(() => window.playedCues);
  await expect(sound).toHaveText("Звук выкл.");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");

  await destination("Больница").click();
  await expect.poll(cues).toEqual(["click_001.ogg"]);
  await advance.click();
  await expect.poll(cues).toEqual(["click_001.ogg", "confirmation_001.ogg"]);
  await advance.click();
  await expect.poll(cues).toHaveLength(3);
  await page.getByRole("radio", { name: "Оставить закрытым" }).check();
  await advance.click();
  await expect.poll(cues).toHaveLength(4);
  expect((await cues()).at(-1)).toBe("switch_001.ogg");

  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await advance.click();
  await expect(page.locator("#turn-number")).toHaveText("5");
  expect(await cues()).toHaveLength(4);

  const credits = page.getByRole("link", { name: "Авторы и лицензии ассетов" });
  const url = new URL(await credits.getAttribute("href"), page.url());
  expect(url.pathname).toBe(new URL("assets/CREDITS.txt", baseURL).pathname);
  const attribution = await page.request.get(url.href);
  expect(attribution.ok()).toBe(true);
  expect(await attribution.text()).toMatch(/Paweł Kuna[\s\S]*The Inter Project Authors[\s\S]*Kenney/);

  for (const [file, text] of [
    ["tabler/LICENSE.txt", "MIT License"],
    ["inter/LICENSE.txt", "SIL OPEN FONT LICENSE"],
    ["kenney/License.txt", "Creative Commons Zero"],
  ]) {
    const license = await page.request.get(new URL(file, url).href);
    expect(license.ok()).toBe(true);
    expect(await license.text()).toContain(text);
  }
  expect(problems).toEqual([]);
});
