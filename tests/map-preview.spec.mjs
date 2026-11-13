import { expect, test } from "@playwright/test";

// Coordinates from the scenario map. Clicks go through Phaser rather than the HTML controls.
const markers = {
  bus1Start: [1012, 312],
  hospital: [1250, 148],
  junction: [1012, 378],
  shelter: [286, 378],
  embankment: [865, 676],
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
  const route = (name) => page.locator("#selected-routes li").filter({ has: page.getByText(name.replace("Автобус ", ""), { exact: true }) });
  return {
    advance: page.getByRole("button", { name: "Выполнить ход" }),
    confirmation: page.locator("#unassigned-dialog"),
    wait: page.getByRole("button", { name: "Ждать", exact: true }),
    vehicle,
    destination,
    route,
    async order(name, target) {
      await vehicle(name).click();
      await expect(vehicle(name)).toHaveAttribute("aria-pressed", "true");
      await destination(target).press("Enter");
      await expect(route(name)).toContainText("→ " + target);
    },
  };
}

function routeStatus(page, name) {
  return page.getByRole("list", { name: "Состояние маршрутов" })
    .getByRole("listitem").filter({ hasText: name }).locator("span");
}

async function confirmIncompleteTurn(page) {
  const { advance, confirmation } = controls(page);
  await advance.click();
  await confirmation.getByRole("button", { name: "Всё равно выполнить" }).click();
}

async function clickMarker(canvas, [x, y]) {
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Карта не видна.");
  await canvas.click({ position: { x: bounds.width * x / 1740, y: bounds.height * y / 840 } });
}

async function expectNoHorizontalScroll(page) {
  expect(await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  })).toBe(true);
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
  const { advance, vehicle, destination, order, route, confirmation, wait } = controls(page);
  await expect(canvas).toBeVisible();
  await expectNoHorizontalScroll(page);
  const queues = page.getByRole("list", { name: "Ожидают эвакуации по районам" });
  if (page.viewportSize().width <= 600) {
    await expect(queues).toHaveCSS("clip-path", "none");
    await expect(queues.getByRole("listitem")).toHaveText([
      "Больница ждут 36", "Школа ждут 18", "Набережная ждут 54",
    ]);
  }
  await expect(page.getByRole("button", { name: "Звуки игры" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => document.fonts.check('700 38px "Bridge Inter"', "Убежище"))).toBe(true);
  await expect(advance).toBeEnabled();
  expect(await canvas.evaluate((element) =>
    Boolean(element.getContext("webgl2") || element.getContext("webgl"))
  )).toBe(true);
  await expect(turn).toHaveText("1");
  for (const name of ["Автобус А1", "Автобус А2", "Паром"]) {
    await expect(vehicle(name)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(destination("Больница")).toBeHidden();
  await expect(wait).toBeDisabled();
  const lowerRoad = page.getByRole("button", { name: "Нижняя дорога", exact: true });
  const roadInfo = page.getByRole("region", { name: "Нижняя дорога", exact: true });
  await lowerRoad.hover();
  await expect(lowerRoad).toHaveCSS("background-color", "rgb(226, 240, 232)");
  await lowerRoad.click();
  await expect(roadInfo).toContainText("Закроется через 3 хода.");
  await expect(roadInfo).toContainText("Последний проезд: ход 3.");
  await roadInfo.getByText("Закроется через 3 хода.").click();
  await expect(roadInfo).toBeVisible();
  await clickMarker(canvas, [110, 110]);
  await expect(roadInfo).toBeHidden();
  await expect(lowerRoad).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#turn-guide")).toContainText("забирает до 18 человек перед выездом");
  await expect(page.locator("#turn-feedback")).toBeEmpty();
  const help = page.getByRole("button", { name: "Как играть", exact: true });
  await help.press("Enter");
  await expect(page.getByRole("dialog", { name: "Как играть" })).toBeVisible();
  await expect(page.getByText(/За ход каждая машина проезжает один участок/)).toBeVisible();
  await expect(page.getByText(/После последнего доступного хода маршрут закроется/)).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(help).toBeFocused();
  await expect(score).toHaveText("0 / 108");
  await page.getByText("Прогноз закрытий", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Последний доступный ход" }).getByRole("row", { name: /Закрыт/ }).getByRole("cell")).toHaveText(["4", "6"]);
  await expect(page.getByRole("table", { name: "Последний доступный ход" }).getByRole("row", { name: /Открыт/ }).getByRole("cell")).toHaveText(["9", "4"]);
  await page.getByText("Прогноз закрытий", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Оставить закрытым" })).toBeHidden();

  await vehicle("Паром").click();
  await clickMarker(canvas, markers.bus1Start);
  await expect(vehicle("Автобус А1")).toHaveAttribute("aria-pressed", "true");
  await clickMarker(canvas, markers.hospital);
  await expect(route("Автобус А1")).toContainText("Развязка → Больница");
  await expect(vehicle("Автобус А1")).toHaveAttribute("aria-pressed", "true");
  await clickMarker(canvas, [110, 110]);
  await expect(vehicle("Автобус А1")).toHaveAttribute("aria-pressed", "false");
  await expect(destination("Больница")).toBeHidden();
  await expect(route("Автобус А1")).toContainText("Развязка → Больница");
  await order("Автобус А2", "Развязка");
  await vehicle("Паром").click();
  await clickMarker(canvas, markers.embankment);
  await expect(route("Паром")).toContainText("→ Набережная");
  await advance.click();
  await expect(turn).toHaveText("2");
  await expect(score).toHaveText("0 / 108");
  await expect(vehicle("Автобус А2")).toContainText("18/18 мест занято");
  await expect(queues.getByRole("listitem").nth(1)).toHaveText("Школа ждут 0");
  await expect(page.locator("#turn-feedback")).toContainText("Ход 1 выполнен. Посадка: 18 чел. Доставлено в убежище: 0 чел.");
  await expect(page.locator("#turn-guide")).toContainText("Через мост за ход проезжает один автобус.");

  await vehicle("Автобус А1").click();
  const initialViewport = page.viewportSize();
  const initialCanvas = await canvas.boundingBox();
  await page.setViewportSize({ width: initialViewport.width <= 600 ? 540 : 700, height: 820 });
  await expect.poll(async () => (await canvas.boundingBox())?.width).not.toBe(initialCanvas.width);
  await clickMarker(canvas, markers.junction);
  await expect(route("Автобус А1")).toContainText("→ Развязка");
  await page.setViewportSize(initialViewport);
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBeCloseTo(initialCanvas.width, 0);
  await expectNoHorizontalScroll(page);
  await order("Автобус А2", "Убежище");
  await order("Паром", "Убежище");
  await advance.click();
  await expect(turn).toHaveText("3");
  await expect(score).toHaveText("36 / 108");
  await expect(page.locator("#turn-feedback")).toContainText("Доставлено в убежище: 36 чел.");
  await expect(page.locator("#turn-guide")).toContainText("раньше закрывает паромную переправу");

  await lowerRoad.press("Enter");
  await expect(roadInfo).toContainText("Закроется после этого хода.");
  await page.keyboard.press("Escape");
  await expect(roadInfo).toBeHidden();
  await vehicle("Автобус А1").focus();
  await page.keyboard.press("Enter");
  await destination("Убежище").focus();
  await page.keyboard.press("Enter");
  await expect(route("Автобус А1")).toContainText("→ Убежище");
  await order("Паром", "Набережная");
  await expect(advance).toBeDisabled();
  const keepClosed = page.getByRole("radio", { name: "Оставить закрытым" });
  await expect(keepClosed).not.toBeChecked();
  await keepClosed.check();
  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("4");
  await expect(keepClosed).toBeHidden();
  await expect(score).toHaveText("54 / 108");
  await expect(routeStatus(page, "Нижняя дорога")).toHaveText("Закрыто");
  await lowerRoad.click();
  await expect(roadInfo).toContainText("Участок уже закрыт.");
  await expect(roadInfo).toContainText("Закрыт с 4-го хода.");

  await vehicle("Паром").click();
  await expect(roadInfo).toBeHidden();
  await clickMarker(canvas, markers.shelter);
  await expect(route("Паром")).toContainText("→ Убежище");
  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("5");
  await expect(score).toHaveText("72 / 108");
  await expect(routeStatus(page, "Мост")).toHaveText("Закрыто");
  await expect(page.locator("#turn-feedback")).toContainText("С хода 5 проезд закрыт: мост.");
  await vehicle("Автобус А1").click();
  await expect(destination("Развязка")).toBeHidden();
  await expect(route("Автобус А1")).toContainText("Ждёт автоматически");
  await expect(route("Автобус А2")).toContainText("Ждёт автоматически");

  await order("Паром", "Набережная");
  await expect(page.locator("#order-count")).toHaveText("3 из 3 готовы");
  await advance.click();
  await expect(confirmation).toBeHidden();
  await expect(turn).toHaveText("6");
  await expect(score).toHaveText("72 / 108");
  await clickMarker(canvas, markers.shelter);
  await expect(route("Паром")).toContainText("→ Убежище");
  await advance.click();

  const results = page.getByRole("region", { name: "Итоги эвакуации" });
  await expect(results).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expect(results.locator(".icon-rotate")).toHaveCSS("mask-image", /assets\/tabler\/rotate\.svg/);
  await expect(results.getByText("Вывезено 90 из 108")).toBeVisible();
  await expect(results.getByText("Мост и паромная переправа закрыты.")).toBeVisible();
  await page.getByText("Журнал эвакуации", { exact: true }).click();
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
  await expect(routeStatus(page, "Мост")).toHaveText("По 4-й ход");
  for (const [name, location] of [["Автобус А1", "Развязка"], ["Автобус А2", "Школа"], ["Паром", "Убежище"]]) {
    await expect(vehicle(name)).toHaveAttribute("aria-pressed", "false");
    await expect(vehicle(name).locator(".vehicle-location")).toHaveText(location);
    await expect(vehicle(name).locator(".vehicle-occupancy")).toHaveText("0/18 мест занято");
  }
  await expect(advance).toBeEnabled();

  if (new URL(baseURL).pathname !== "/") {
    await expect(page.locator("script[type=module][src]")).toHaveAttribute("src", /^\.\/assets\//);
  }
  expect(requests).toEqual(expect.arrayContaining([
    expect.stringMatching(/\/assets\/transport\/bus\.svg$/),
    expect.stringMatching(/\/assets\/transport\/ferry\.svg$/),
    expect.stringMatching(/\/assets\/tabler\/rotate\.svg$/),
    expect.stringMatching(/\/assets\/inter\/InterVariable\.woff2$/),
  ]));
  expect(requests.some((path) => path.endsWith(".ogg"))).toBe(false);
  expect(problems).toEqual([]);
});

test("План Б: прогноз можно менять до подтверждения, затем действует открытый водосброс", async ({ page, baseURL }) => {
  const problems = watchPage(page, baseURL);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("./");
  expect(response?.ok()).toBe(true);
  await expectNoHorizontalScroll(page);
  const turn = page.locator("#turn-number");
  const score = page.locator("#score");
  const { advance, vehicle, destination, order, route, confirmation } = controls(page);
  const keepClosed = page.getByRole("radio", { name: "Оставить закрытым" });
  const open = page.getByRole("radio", { name: "Открыть водосброс" });
  const forecasts = page.getByRole("table", { name: "Последний доступный ход" });

  await vehicle("Автобус А1").click();
  await clickMarker(page.locator("#map canvas"), markers.embankment);
  await expect(route("Автобус А1")).toContainText("→ Набережная");
  await order("Автобус А2", "Развязка");
  await order("Паром", "Набережная");
  await advance.click();
  await order("Автобус А1", "Развязка");
  await order("Автобус А2", "Убежище");
  await order("Паром", "Убежище");
  await advance.click();
  await expect(turn).toHaveText("3");
  await expect(advance).toBeDisabled();
  await expect(advance).toHaveText("Выполнить ход · выбери водосброс");
  const decision = page.getByRole("group", { name: "Выбери режим водосброса" });
  await expect(decision).toBeInViewport();
  await expect(decision).toContainText("Мост по 4-й ход · Паром по 6-й ход");
  await expect(decision).toContainText("Мост по 9-й ход · Паром по 4-й ход");
  await expect(open).not.toBeChecked();
  await expect(page.locator("#order-status")).toContainText("выбери режим водосброса");
  await order("Автобус А1", "Убежище");
  await order("Паром", "Набережная");
  const before = await page.locator("#selected-routes").innerText();
  const journalBefore = await page.locator("#journal").innerText();

  await open.focus();
  await page.keyboard.press("Space");
  await expect(open).toBeChecked();
  await expect(advance).toBeEnabled();
  await expect(advance).toHaveText("Выполнить ход");
  await expect(routeStatus(page, "Мост")).toHaveText("По 9-й ход");
  await expect(routeStatus(page, "Переправа")).toHaveText("По 4-й ход");
  await expect(routeStatus(page, "Нижняя дорога")).toHaveText("Последний ход");
  const bridgeLabel = page.getByRole("button", { name: "Мост", exact: true });
  const bridgeInfo = page.getByRole("region", { name: "Мост", exact: true });
  await bridgeLabel.click();
  await expect(bridgeInfo).toContainText("Открыт до конца партии.");
  await expect(bridgeInfo).toContainText("Последний проезд: ход 9 при открытом водосбросе.");
  await keepClosed.check();
  await expect(bridgeInfo).toBeHidden();
  await bridgeLabel.click();
  await expect(bridgeInfo).toContainText("Закроется через 2 хода.");
  await expect(bridgeInfo).toContainText("Последний проезд: ход 4 при закрытом водосбросе.");
  await expect(routeStatus(page, "Мост")).toHaveText("По 4-й ход");
  await expect(routeStatus(page, "Переправа")).toHaveText("По 6-й ход");
  await open.check();
  await expect(turn).toHaveText("3");
  await expect(score).toHaveText("36 / 108");
  await expect(page.locator("#turn-feedback")).toContainText("Доставлено в убежище: 36 чел.");
  await expect(page.locator("#turn-guide")).toContainText("раньше закрывает паромную переправу");
  await expect(page.locator("#selected-routes")).toHaveText(before, { useInnerText: true });
  await expect(page.locator("#journal")).toHaveText(journalBefore, { useInnerText: true });

  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("4");
  await expect(score).toHaveText("54 / 108");
  await expect(open).toBeHidden();
  await page.getByText("Прогноз закрытий", { exact: true }).click();
  await expect(forecasts.getByRole("row", { name: /Открыт · выбран/ })).toBeVisible();
  await page.getByText("Журнал эвакуации", { exact: true }).click();
  await expect(page.getByText("Водосброс открыт.", { exact: true })).toBeVisible();
  await expect(routeStatus(page, "Нижняя дорога")).toHaveText("Закрыто");

  await order("Автобус А1", "Развязка");
  await order("Паром", "Убежище");
  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("5");
  await expect(score).toHaveText("72 / 108");
  await expect(vehicle("Автобус А1")).toContainText("Развязка");
  await expect(routeStatus(page, "Переправа")).toHaveText("Закрыто");
  await expect(page.locator("#turn-feedback")).toContainText("С хода 5 проезд закрыт: переправа.");
  await expect(destination("Набережная")).toBeHidden();
  await expect(route("Паром")).toContainText("Ждёт автоматически");

  await order("Автобус А1", "Больница");
  await advance.click();
  await expect(confirmation).toContainText("Без приказа: Автобус А2.");
  await confirmation.getByRole("button", { name: "Всё равно выполнить" }).click();
  await expect(turn).toHaveText("6");
  await order("Автобус А1", "Развязка");
  await order("Автобус А2", "Развязка");
  await advance.click();
  await expect(turn).toHaveText("7");
  await expect(score).toHaveText("72 / 108");
  await expect(vehicle("Автобус А1")).toContainText("18/18 мест занято");
  await order("Автобус А1", "Убежище");
  await order("Автобус А2", "Больница");
  await advance.click();
  await expect(turn).toHaveText("8");
  await expect(score).toHaveText("90 / 108");
  await order("Автобус А2", "Развязка");
  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("9");
  await expect(vehicle("Автобус А2")).toContainText("18/18 мест занято");
  await order("Автобус А2", "Убежище");
  await expect(page.locator("#turn-guide")).toHaveText("Последний ход для проезда: мост.");
  await confirmIncompleteTurn(page);

  const results = page.getByRole("region", { name: "Итоги эвакуации" });
  await expect(turn).toHaveText("9");
  await expectNoHorizontalScroll(page);
  await expect(results.getByText("Вывезено 108 из 108")).toBeVisible();
  await expect(results.getByText("Все жители в убежище.")).toBeVisible();
  await expect(page.locator("#turn-feedback")).toContainText("Ход 9 выполнен. Посадка: 0 чел. Доставлено в убежище: 18 чел.");
  for (const [district, values] of [["Больница", ["36", "0", "0"]], ["Школа", ["18", "0", "0"]], ["Набережная", ["54", "0", "0"]]]) {
    await expect(results.getByRole("row", { name: new RegExp(district) }).getByRole("cell")).toHaveText(values);
  }
  await results.getByRole("button", { name: "Повторить" }).click();
  await expect(score).toHaveText("0 / 108");
  await expect(forecasts.getByRole("row", { name: /выбран/ })).toHaveCount(0);
  await expect(page.locator("#journal > li")).toHaveCount(0);
  await expect(page.locator("#turn-feedback")).toBeEmpty();
  await confirmIncompleteTurn(page);
  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("3");
  await expect(open).not.toBeChecked();
  await expect(keepClosed).not.toBeChecked();
  await expect(advance).toBeDisabled();
  expect(problems).toEqual([]);
});

test("Ход без всех приказов требует подтверждения, а явное ожидание считается приказом", async ({ page }) => {
  await page.goto("./");
  const turn = page.locator("#turn-number");
  const { advance, confirmation, vehicle, wait, order, route } = controls(page);
  const bus1 = vehicle("Автобус А1");
  const bus2 = vehicle("Автобус А2");
  await expect(route("Автобус А1")).toContainText("Без приказа");
  await expect(wait).toHaveAttribute("aria-pressed", "false");
  await order("Автобус А1", "Больница");
  await bus2.click();
  await wait.click();
  await expect(route("Автобус А2")).toContainText("Ждать");
  await expect(bus1).toHaveClass(/planned/);
  await expect(bus2).toHaveClass(/planned/);
  await expect(wait).toHaveAttribute("aria-pressed", "true");
  await advance.click();
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("Без приказа: Паром.");
  await expect(confirmation.getByRole("button", { name: "Вернуться к приказам" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(turn).toHaveText("1");
  await expect(route("Автобус А1")).toContainText("→ Больница");
  await expect(route("Автобус А2")).toContainText("Ждать");
  await vehicle("Паром").click();
  await wait.click();
  await advance.click();
  await expect(turn).toHaveText("2");
  await expect(confirmation).toBeHidden();
  await expect(route("Автобус А1")).toContainText("Без приказа");
  await expect(page.locator("#vehicles .planned")).toHaveCount(0);
});

test("Удержание Enter выполняет только один ход", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const turn = page.locator("#turn-number");
  const { advance, confirmation, vehicle, wait } = controls(page);
  for (const name of ["Автобус А1", "Автобус А2", "Паром"]) {
    await vehicle(name).click();
    await wait.click();
  }
  await expect(advance).toBeEnabled();
  await advance.focus();
  await page.keyboard.down("Enter");
  await expect(turn).toHaveText("2");
  await expect(advance).toBeFocused();
  await expect(advance).toHaveCSS("outline-style", "solid");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(turn).toHaveText("2");
  await page.keyboard.press("Enter");
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "Вернуться к приказам" })).toBeFocused();
  await page.keyboard.down("Enter");
  await expect(confirmation).toBeHidden();
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(confirmation).toBeHidden();
  await expect(turn).toHaveText("2");
  await confirmIncompleteTurn(page);
  await expect(turn).toHaveText("3");
  await expect(advance).toBeDisabled();
});

test("Встречные автобусы блокируют ход, приказ можно снять", async ({ page }) => {
  await page.goto("./");
  const { advance, vehicle, wait, order, route } = controls(page);
  await order("Автобус А1", "Убежище");
  await order("Автобус А2", "Развязка");
  await vehicle("Паром").click();
  await wait.click();
  await advance.dblclick();
  await expect(page.locator("#turn-number")).toHaveText("2");
  await order("Автобус А1", "Развязка");
  await order("Автобус А2", "Убежище");
  await expect(advance).toBeDisabled();
  await expect(page.locator("#order-status")).toContainText("На мосту два приказа");
  await expect(route("Автобус А1")).toContainText("конфликт на мосту");
  await expect(route("Автобус А2")).toContainText("конфликт на мосту");
  await expect(page.locator("#score")).toHaveText("0 / 108");
  await vehicle("Автобус А1").click();
  await wait.click();
  await expect(advance).toBeEnabled();
  await confirmIncompleteTurn(page);
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
  const { destination, vehicle } = controls(page);
  const sound = page.getByRole("button", { name: "Звуки игры" });
  const cues = () => page.evaluate(() => window.playedCues);
  await expect(sound).toHaveText("Звук выкл.");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");

  await vehicle("Автобус А1").click();
  await destination("Больница").press("Enter");
  await expect.poll(cues).toEqual(["click_001.ogg"]);
  await confirmIncompleteTurn(page);
  await expect.poll(cues).toEqual(["click_001.ogg", "confirmation_001.ogg"]);
  await confirmIncompleteTurn(page);
  await expect.poll(cues).toHaveLength(3);
  await page.getByRole("radio", { name: "Оставить закрытым" }).check();
  await confirmIncompleteTurn(page);
  await expect.poll(cues).toHaveLength(4);
  expect((await cues()).at(-1)).toBe("switch_001.ogg");

  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await confirmIncompleteTurn(page);
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
