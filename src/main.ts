import Phaser from "phaser";
import { MapPreview } from "./map-preview";
import { districtIds, firstScenario, vehicleIds } from "./game/scenario.ts";
import type { FloodgateMode, NodeId, ScenarioRouteId, VehicleId } from "./game/scenario.ts";
import { advanceTurn, createInitialState, getEvacuationReport, getRouteForecast, validateTurn } from "./game/turn.ts";
import type { EndReason, TurnEvent, TurnOrders } from "./game/turn.ts";
import { GameSounds } from "./game-sounds";
import "./style.css";

const { map, nodes, routes, vehicles } = firstScenario;
const nodeIds = Object.keys(nodes) as NodeId[];

const mapElement = document.querySelector<HTMLDivElement>("#map")!;
const planning = document.querySelector<HTMLElement>("#planning")!;
const result = document.querySelector<HTMLElement>("#result")!;
const resultTitle = document.querySelector<HTMLHeadingElement>("#result-title")!;
const loading = document.querySelector<HTMLElement>("#loading")!;
const soundToggle = document.querySelector<HTMLButtonElement>("#sound-toggle")!;
const sounds = new GameSounds();

soundToggle.addEventListener("click", () => {
  sounds.enabled = !sounds.enabled;
  soundToggle.setAttribute("aria-pressed", String(sounds.enabled));
  soundToggle.textContent = sounds.enabled ? "Звук вкл." : "Звук выкл.";
  if (!sounds.enabled) sounds.stop();
});
const advance = document.querySelector<HTMLButtonElement>("#advance")!;
const restart = document.querySelector<HTMLButtonElement>("#restart")!;
const orderStatus = document.querySelector<HTMLElement>("#order-status")!;
const turnGuide = document.querySelector<HTMLElement>("#turn-guide")!;
const turnFeedback = document.querySelector<HTMLElement>("#turn-feedback")!;
const gameHelp = document.querySelector<HTMLDetailsElement>(".game-help")!;
const turnNumber = document.querySelector<HTMLElement>("#turn-number")!;
const score = document.querySelector<HTMLElement>("#score")!;
const resultScore = document.querySelector<HTMLElement>("#result-score")!;
const resultReason = document.querySelector<HTMLElement>("#result-reason")!;
const resultRows = document.querySelector<HTMLTableSectionElement>("#district-results")!;
const journal = document.querySelector<HTMLOListElement>("#journal")!;
const journalEmpty = document.querySelector<HTMLElement>("#journal-empty")!;

const floodgateStatus = document.querySelector<HTMLElement>("#floodgate-status")!;
const forecast = document.querySelector<HTMLElement>("#forecast")!;
const forecastRows = document.querySelector<HTMLTableSectionElement>("#forecast-rows")!;
const floodgateChoice = document.querySelector<HTMLFieldSetElement>("#floodgate-choice")!;
const floodgateInputs = Array.from(floodgateChoice.querySelectorAll<HTMLInputElement>("input"));
const forecastModes = ["closed", "open"] as const;
const floodgateLabels: Record<FloodgateMode, string> = { closed: "Закрыт", open: "Открыт" };
const forecasts = { closed: getRouteForecast("closed"), open: getRouteForecast("open") };
const forecastRowsByMode = new Map<FloodgateMode, { row: HTMLTableRowElement; status: HTMLSpanElement }>();

let state = createInitialState();
let resolving = false;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let draftFloodgate: FloodgateMode | undefined;
let moves: Partial<Record<VehicleId, NodeId | null>> = {};
let selected: VehicleId = "bus-1";
const vehicleButtons = new Map<VehicleId, HTMLButtonElement>();
const destinationButtons = new Map<NodeId, HTMLButtonElement>();
const routeList = document.querySelector("#routes")!;
const routeItems = new Map<ScenarioRouteId, HTMLLIElement>();

function makeButton(parent: Element, label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  parent.append(button);
  return button;
}

function vehicleName(id: VehicleId) {
  const vehicle = vehicles[id];
  return vehicle.kind === "ferry" ? "Паром" : "Автобус " + vehicle.label;
}

function routeName(id: ScenarioRouteId) {
  return routes.find((route) => route.id === id)!.label;
}

function availableDestinations(vehicle: VehicleId): NodeId[] {
  if (state.endReason !== null) return [];
  const from = state.vehicles[vehicle].node;
  const destinations: NodeId[] = [];
  for (const { id, ends: [a, b], vehicleKind } of routes) {
    if (vehicleKind !== vehicles[vehicle].kind || state.closedRoutes.includes(id)) continue;
    if (from === a) destinations.push(b);
    if (from === b) destinations.push(a);
  }
  return destinations;
}

function isDecisionTurn() {
  return state.endReason === null && state.turn === firstScenario.decisionTurn && state.floodgate === null;
}

function turnOrders(): TurnOrders {
  return isDecisionTurn() ? { moves, floodgate: draftFloodgate } : { moves };
}

function selectVehicle(id: VehicleId) {
  if (resolving || state.endReason !== null) return;
  selected = id;
  render();
}

function assign(destination: NodeId | null) {
  if (resolving || state.endReason !== null) return;
  if (destination !== null && !availableDestinations(selected).includes(destination)) return;
  moves = { ...moves, [selected]: destination };
  sounds.play("order");
  render();
}

const vehicleGroup = document.querySelector("#vehicles")!;
for (const id of vehicleIds) {
  const button = makeButton(vehicleGroup, "", () => selectVehicle(id));
  button.setAttribute("aria-label", vehicleName(id));
  vehicleButtons.set(id, button);
}

const destinationGroup = document.querySelector("#destinations")!;
for (const id of nodeIds) {
  destinationButtons.set(id, makeButton(destinationGroup, nodes[id].label, () => assign(id)));
}
const wait = makeButton(destinationGroup, "Ждать", () => assign(null));

for (const route of routes) {
  if (route.lastOpenTurn === null) continue;
  const item = document.createElement("li");
  routeList.append(item);
  routeItems.set(route.id, item);
}

for (const mode of forecastModes) {
  const row = forecastRows.insertRow();
  const heading = document.createElement("th");
  heading.scope = "row";
  const status = document.createElement("span");
  status.className = "forecast-status";
  heading.append(floodgateLabels[mode], status);
  row.append(heading);
  for (const id of ["bridge", "ferry-crossing"] as const) {
    const route = forecasts[mode].find(({ route }) => route === id)!;
    row.insertCell().textContent = String(route.lastOpenTurn);
  }
  forecastRowsByMode.set(mode, { row, status });
}

for (const input of floodgateInputs) {
  input.addEventListener("change", () => {
    if (resolving || !isDecisionTurn() || !input.checked) return;
    draftFloodgate = input.value === "open" ? "open" : "closed";
    render();
  });
}

function renderForecast() {
  const shownMode = state.floodgate ?? draftFloodgate ?? "closed";
  const chosen = state.floodgate !== null;
  floodgateChoice.hidden = !isDecisionTurn();
  for (const input of floodgateInputs) input.checked = input.value === draftFloodgate;
  floodgateChoice.disabled = resolving;
  for (const [mode, { row, status }] of forecastRowsByMode) {
    const isShown = shownMode === mode;
    row.classList.toggle("forecast-active", isShown);
    status.textContent = isShown ? (chosen ? " · выбран" : " · на карте") : "";
  }
  floodgateStatus.textContent = chosen
    ? "Водосброс " + floodgateLabels[shownMode].toLowerCase()
    : "На карте прогноз: водосброс " + floodgateLabels[shownMode].toLowerCase();
  return shownMode;
}

function describeNextStep() {
  if (state.turn === 1) {
    return "Назначь маршруты автобусам и парому, затем выполни ход. Пустая машина забирает до 18 человек перед выездом.";
  }
  if (state.turn === 2) {
    return "Пассажиры засчитываются только в убежище. Через мост за ход проезжает один автобус.";
  }
  if (isDecisionTurn()) {
    return "Открытый водосброс дольше держит мост доступным, но раньше закрывает паромную переправу.";
  }
  const mode = state.floodgate ?? "closed";
  const lastChance = forecasts[mode].filter(({ lastOpenTurn }) => lastOpenTurn === state.turn);
  if (lastChance.length) {
    return "Последний ход для проезда: " + lastChance.map(({ route }) => routeName(route).toLowerCase()).join(", ") + ".";
  }
  return "";
}

function render() {
  const available = availableDestinations(selected);
  const issues = validateTurn(state, turnOrders());
  const conflicts = issues.filter((issue) => issue.kind === "route-capacity");
  const forecastMode = renderForecast();
  const finished = state.endReason !== null;
  const report = getEvacuationReport(state);

  turnNumber.textContent = String(state.turn);
  score.textContent = report.total.evacuated + " / " + report.total.initial;
  planning.hidden = finished;
  result.hidden = !finished;
  const guide = describeNextStep();
  turnGuide.textContent = guide;
  turnGuide.hidden = !guide;

  for (const id of vehicleIds) {
    const button = vehicleButtons.get(id)!;
    const current = state.vehicles[id];
    const destination = moves[id];
    const conflict = conflicts.some((issue) => issue.vehicles.includes(id));
    const title = document.createElement("strong");
    const icon = document.createElement("span");
    icon.className = "asset-icon icon-" + vehicles[id].kind;
    icon.setAttribute("aria-hidden", "true");
    title.append(icon, vehicleName(id));
    const location = document.createElement("span");
    location.textContent = nodes[current.node].label + " · " + (current.passengers?.count ?? 0) + "/" + vehicles[id].seats + " мест занято";
    const order = document.createElement("span");
    order.textContent = destination ? "→ " + nodes[destination].label : "Ждать";
    if (conflict) order.textContent += " · конфликт на мосту";
    button.replaceChildren(title, location, order);
    button.disabled = resolving;
    button.setAttribute("aria-pressed", String(id === selected));
    button.classList.toggle("conflict", conflict);
    if (conflict) button.setAttribute("aria-describedby", "order-status");
    else button.removeAttribute("aria-describedby");
  }

  destinationGroup.setAttribute("aria-label", "Назначить маршрут · " + vehicleName(selected));
  for (const [id, button] of destinationButtons) {
    button.hidden = !available.includes(id);
    button.disabled = resolving;
    button.setAttribute("aria-pressed", String(moves[selected] === id));
  }
  wait.setAttribute("aria-pressed", String(!moves[selected]));

  wait.disabled = resolving;
  advance.disabled = resolving || finished || issues.length > 0;
  advance.textContent = resolving ? "Выполняется ход…" : "Выполнить ход";
  if (conflicts.length) {
    orderStatus.textContent = "На мосту два приказа. Измени маршрут одного автобуса.";
  } else if (isDecisionTurn() && !draftFloodgate) {
    orderStatus.textContent = "Чтобы выполнить ход, выбери режим водосброса.";
  } else if (moves[selected]) {
    orderStatus.textContent = "Приказ принят. Можно назначить маршрут другой машине или выполнить ход.";
  } else {
    orderStatus.textContent = available.length
      ? "Выбери соседний узел на карте или в списке."
      : "Для этого транспорта открытых маршрутов нет.";
  }
  orderStatus.classList.toggle("error", conflicts.length > 0);

  for (const { route, lastOpenTurn } of forecasts[forecastMode]) {
    const item = routeItems.get(route);
    if (!item) continue;
    const closed = state.closedRoutes.includes(route);
    item.textContent = routeName(route) + " · " + (closed ? "закрыт" : "последний ход " + lastOpenTurn);
    item.classList.toggle("closed", closed);
  }

  scene.renderState({ state, moves, selected, available, forecastMode, conflicts: conflicts.map((issue) => issue.route) });
}

function describeEvent(event: TurnEvent): string | null {
  switch (event.kind) {
    case "boarded":
      return vehicleName(event.vehicle) + " · посадка " + event.passengers.count + " чел. · " + nodes[event.passengers.district].label;
    case "evacuated":
      return vehicleName(event.vehicle) + " · в убежище +" + event.passengers.count + " · " + nodes[event.passengers.district].label;
    case "moved":
      return vehicleName(event.vehicle) + " · " + nodes[event.from].label + " → " + nodes[event.to].label;
    case "route-closed":
      return routeName(event.route) + " · закрытие перед ходом " + event.turn;
    case "floodgate-chosen":
      return event.mode === "open" ? "Водосброс открыт." : "Водосброс оставлен закрытым.";
    case "game-ended":
      return null;
  }
}

function showTurnFeedback(events: readonly TurnEvent[], turn: number) {
  const boarded = events.reduce((total, event) => total + (event.kind === "boarded" ? event.passengers.count : 0), 0);
  const evacuated = events.reduce((total, event) => total + (event.kind === "evacuated" ? event.passengers.count : 0), 0);
  const moved = events.some((event) => event.kind === "moved");
  const summary = document.createElement("p");
  const title = document.createElement("strong");
  title.textContent = "Ход " + turn + " выполнен.";
  const details = moved
    ? " Посадка: " + boarded + " чел. Доставлено в убежище: " + evacuated + " чел."
    : " Транспорт остался на местах.";
  summary.append(title, details);
  turnFeedback.replaceChildren(summary);

  for (const event of events) {
    if (event.kind !== "route-closed") continue;
    const closure = document.createElement("p");
    closure.className = "closure";
    closure.textContent = "С хода " + event.turn + " проезд закрыт: " + routeName(event.route).toLowerCase() + ".";
    turnFeedback.append(closure);
  }
}

function addJournalEntries(events: readonly TurnEvent[], turn: number) {
  const entries = events.map(describeEvent).filter((entry) => entry !== null);
  if (entries.length === 0) entries.push("Транспорт остался на местах.");
  const entry = document.createElement("li");
  const heading = document.createElement("strong");
  heading.textContent = "Ход " + turn;
  const details = document.createElement("ul");
  for (const text of entries) {
    const item = document.createElement("li");
    item.textContent = text;
    details.append(item);
  }
  entry.append(heading, details);
  journal.prepend(entry);
  journalEmpty.hidden = true;
}

const endMessages: Record<EndReason, string> = {
  "all-evacuated": "Все жители в убежище.",
  "shelter-isolated": "Мост и паромная переправа закрыты.",
  "turn-limit": "Время эвакуации истекло.",
};

function showResult(reason: EndReason) {
  const { districts, total } = getEvacuationReport(state);
  resultScore.textContent = "Вывезено " + total.evacuated + " из " + total.initial;
  resultReason.textContent = endMessages[reason];
  resultRows.replaceChildren();
  for (const district of districtIds) {
    const { evacuated, waiting, inTransit } = districts[district];
    const row = resultRows.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = nodes[district].label;
    row.append(name);
    for (const value of [evacuated, waiting, inTransit]) row.insertCell().textContent = String(value);
  }
  resultTitle.focus();
}

advance.addEventListener("click", async (event) => {
  if (resolving || event.detail > 1) return;
  const turn = state.turn;
  const next = advanceTurn(state, turnOrders());
  if (!next.ok) return;
  const restoreFocus = document.activeElement === advance;
  if (!reduceMotion.matches && next.events.some((event) => event.kind === "moved")) {
    resolving = true;
    render();
    scene.flashOrders();
    await new Promise<void>((done) => window.setTimeout(done, 280));
    resolving = false;
  }
  state = next.state;
  draftFloodgate = undefined;
  moves = {};
  showTurnFeedback(next.events, turn);
  sounds.play(next.events.some((event) => event.kind === "route-closed") ? "closure" : "turn");
  addJournalEntries(next.events, turn);
  render();
  if (state.endReason !== null) {
    showResult(state.endReason);
  } else if (restoreFocus && (document.activeElement === document.body || document.activeElement === advance)) {
    (isDecisionTurn() ? floodgateInputs[0] : advance).focus();
  }
});

restart.addEventListener("click", () => {
  state = createInitialState();
  draftFloodgate = undefined;
  moves = {};
  selected = "bus-1";
  journal.replaceChildren();
  turnFeedback.replaceChildren();
  gameHelp.open = false;
  journalEmpty.hidden = false;
  render();
  vehicleButtons.get(selected)!.focus();
});

const scene = new MapPreview(assign, selectVehicle, () => {
  loading.hidden = true;
  forecast.hidden = false;
  render();
});

async function startGame() {
  // Phaser draws labels to textures, so load the font before creating the scene.
  await document.fonts.load('700 38px "Bridge Inter"', "Убежище").catch(() => []);
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: mapElement,
    width: map.width,
    height: map.height,
    backgroundColor: "#f3eee1",
    scene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    banner: false,
    audio: { noAudio: true },
  });
}

void startGame();
