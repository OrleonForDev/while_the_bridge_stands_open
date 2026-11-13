import Phaser from "phaser";
import { version } from "../package.json";
import { MapPreview } from "./map-preview";
import { districtIds, firstScenario, vehicleIds } from "./game/scenario.ts";
import type { FloodgateMode, NodeId, Scenario, ScenarioRouteId, VehicleId } from "./game/scenario.ts";
import { lessons, lessonStep } from "./lesson-guide";
import type { LessonStep } from "./lesson-guide";
import { advanceTurn, createInitialState, getEvacuationReport, getRouteForecast, validateTurn } from "./game/turn.ts";
import type { EndReason, TurnEvent, TurnOrders } from "./game/turn.ts";
import { GameSounds } from "./game-sounds";
import "./style.css";

document.querySelector("#build-version")!.textContent = "Версия " + version;

const { map, nodes, routes, vehicles } = firstScenario;
const nodeIds = Object.keys(nodes) as NodeId[];

const mapElement = document.querySelector<HTMLDivElement>("#map")!;
const routeLabels = document.querySelector<HTMLElement>("#route-labels")!;
const routeInfo = document.querySelector<HTMLElement>("#route-info")!;
const routeInfoTitle = document.querySelector<HTMLElement>("#route-info-title")!;
const routeInfoDescription = document.querySelector<HTMLElement>("#route-info-description")!;
const routeInfoForecast = document.querySelector<HTMLElement>("#route-info-forecast")!;
const routeLabelPositions = {
  bridge: [679, 326],
  "ferry-crossing": [640, 554],
  "lower-road": [1058, 568],
} as const;
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
const unassignedDialog = document.querySelector<HTMLDialogElement>("#unassigned-dialog")!;
const unassignedMessage = document.querySelector<HTMLElement>("#unassigned-message")!;
const confirmAdvance = document.querySelector<HTMLButtonElement>("#confirm-advance")!;
const restart = document.querySelector<HTMLButtonElement>("#restart")!;
const orderStatus = document.querySelector<HTMLElement>("#order-status")!;
const orderCount = document.querySelector<HTMLElement>("#order-count")!;
const turnGuide = document.querySelector<HTMLElement>("#turn-guide")!;
const turnFeedback = document.querySelector<HTMLElement>("#turn-feedback")!;
const gameHelp = document.querySelector<HTMLDialogElement>("#game-help")!;
document.querySelector<HTMLButtonElement>("#show-help")!.addEventListener("click", () => gameHelp.showModal());
const turnNumber = document.querySelector<HTMLElement>("#turn-number")!;
const score = document.querySelector<HTMLElement>("#score")!;
const shelterCount = document.querySelector<HTMLElement>("#shelter-count")!;
const shelterNode = nodes[firstScenario.shelter];
shelterCount.style.left = (shelterNode.x / map.width) * 100 + "%";
shelterCount.style.top = ((shelterNode.y + 128) / map.height) * 100 + "%";
const resultScore = document.querySelector<HTMLElement>("#result-score")!;
const resultReason = document.querySelector<HTMLElement>("#result-reason")!;
const resultRows = document.querySelector<HTMLTableSectionElement>("#district-results")!;
const journal = document.querySelector<HTMLOListElement>("#journal")!;
const journalEmpty = document.querySelector<HTMLElement>("#journal-empty")!;
const mapContext = document.querySelector<HTMLElement>("#map-context")!;
const gameGoal = document.querySelector<HTMLElement>("#game-goal")!;
const lessonGuide = document.querySelector<HTMLElement>("#lesson-guide")!;
const lessonTitle = document.querySelector<HTMLElement>("#lesson-title")!;
const lessonInstruction = document.querySelector<HTMLElement>("#lesson-instruction")!;
const lessonActions = document.querySelector<HTMLElement>("#lesson-actions")!;
const lessonMapAction = document.querySelector<HTMLButtonElement>("#lesson-map-action")!;
const lessonNext = document.querySelector<HTMLButtonElement>("#lesson-next")!;
const lessonArrow = document.querySelector<HTMLElement>("#lesson-arrow")!;
const skipLessons = document.querySelector<HTMLButtonElement>("#skip-lessons")!;
const replayLessons = document.querySelector<HTMLButtonElement>("#replay-lessons")!;

const floodgateChoice = document.querySelector<HTMLFieldSetElement>("#floodgate-choice")!;
const floodgateTitle = document.querySelector<HTMLElement>("#floodgate-title")!;
const floodgateInstruction = document.querySelector<HTMLElement>("#floodgate-instruction")!;
const floodgateInputs = Array.from(floodgateChoice.querySelectorAll<HTMLInputElement>("input"));
const forecastModes = ["closed", "open"] as const;
const forecastCrossings = ["bridge", "ferry-crossing"] as const;
const gameGoalText = gameGoal.textContent ?? "";
const progressKey = "while-the-bridge-stands-open.lesson";
const directToGame = new URLSearchParams(location.search).get("level") === "test";
let lessonIndex = directToGame ? lessons.length : savedLessonIndex();
let scenario: Scenario = lessons[lessonIndex]?.scenario ?? firstScenario;
let forecasts = forecastFor(scenario);
let state = createInitialState(scenario);
let comparedForecasts = false;
let guideStep: LessonStep | null = null;
let guideControl: HTMLElement | null = null;
let previousGuide = "";
let resolving = false;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let draftFloodgate: FloodgateMode | undefined;
let moves: Partial<Record<VehicleId, NodeId | null>> = {};
let selected: VehicleId | null = null;
let inspectedRoute: ScenarioRouteId | null = null;
const routeLabelButtons = new Map<ScenarioRouteId, { button: HTMLButtonElement; badge: HTMLSpanElement }>();
const vehicleButtons = new Map<VehicleId, HTMLButtonElement>();
const destinationButtons = new Map<NodeId, HTMLButtonElement>();
const plannedRoutes = new Map<VehicleId, HTMLLIElement>();
const queueList = document.querySelector("#district-queues")!;
const queueCounts = new Map<(typeof districtIds)[number], Text>();
const queueRows = new Map<(typeof districtIds)[number], HTMLLIElement>();
for (const district of districtIds) {
  const item = document.createElement("li");
  const waiting = document.createElement("strong");
  const icon = document.createElement("span");
  icon.className = "asset-icon icon-people";
  icon.setAttribute("aria-hidden", "true");
  const description = document.createElement("span");
  description.className = "sr-only";
  description.textContent = "ждут ";
  const count = document.createTextNode("");
  waiting.append(icon, description, count);
  item.append(nodes[district].label + " ", waiting);
  queueList.append(item);
  queueCounts.set(district, count);
  queueRows.set(district, item);
}

const routeList = document.querySelector("#routes")!;
const routeItems = new Map<ScenarioRouteId, { item: HTMLLIElement; status: HTMLElement }>();

function savedLessonIndex() {
  try {
    const saved = localStorage.getItem(progressKey);
    if (saved === "1") return 1;
    if (saved === String(lessons.length)) return lessons.length;
  } catch {
    // The lessons also work when browser storage is unavailable.
  }
  return 0;
}

function setLevel(index: number) {
  if (resolving) return;
  lessonIndex = index;
  scenario = lessons[index]?.scenario ?? firstScenario;
  forecasts = forecastFor(scenario);
  updateFloodgateTimings();
  try {
    localStorage.setItem(progressKey, String(index));
  } catch {
    // Keep the current session playable when browser storage is unavailable.
  }
  resetLevel();
  const heading = index < lessons.length ? lessonTitle : document.querySelector<HTMLElement>("#map-title")!;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

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

function placeOnMap(element: HTMLElement, [x, y]: readonly [number, number]) {
  element.style.setProperty("--map-x", x / map.width * 100 + "%");
  element.style.setProperty("--map-y", y / map.height * 100 + "%");
}

for (const id of Object.keys(routeLabelPositions) as (keyof typeof routeLabelPositions)[]) {
  const button = makeButton(routeLabels, routeName(id), () => {
    selectVehicle(null);
    if (inspectedRoute === id) {
      closeRouteInfo();
      return;
    }
    closeRouteInfo();
    inspectedRoute = id;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-describedby", "route-info-description route-info-forecast");
    placeOnMap(routeInfo, routeLabelPositions[id]);
    routeInfo.dataset.route = id;
    renderRouteInfo();
    routeInfo.hidden = false;
  });
  const badge = document.createElement("span");
  badge.setAttribute("aria-hidden", "true");
  button.append(badge);
  button.className = "route-label";
  button.setAttribute("aria-controls", routeInfo.id);
  button.setAttribute("aria-expanded", "false");
  placeOnMap(button, routeLabelPositions[id]);
  routeLabelButtons.set(id, { button, badge });
}

function closeRouteInfo() {
  if (inspectedRoute === null) return;
  const { button } = routeLabelButtons.get(inspectedRoute)!;
  button.setAttribute("aria-expanded", "false");
  button.removeAttribute("aria-describedby");
  routeInfo.hidden = true;
  inspectedRoute = null;
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof Node && !routeLabels.contains(target) && !routeInfo.contains(target)) closeRouteInfo();
}, { capture: true });

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || inspectedRoute === null) return;
  const button = routeLabelButtons.get(inspectedRoute)!.button;
  closeRouteInfo();
  button.focus({ preventScroll: true });
});

function renderRouteInfo() {
  if (inspectedRoute === null) return;
  const mode = state.floodgate ?? (scenario === firstScenario ? "closed" : draftFloodgate ?? "closed");
  const { lastOpenTurn, firstClosedTurn } = forecasts[mode].find(({ route }) => route === inspectedRoute)!;
  if (lastOpenTurn === null || firstClosedTurn === null) {
    routeInfoTitle.textContent = routeName(inspectedRoute);
    routeInfoDescription.textContent = "Открыт до конца урока.";
    routeInfoForecast.textContent = "";
    return;
  }

  routeInfoTitle.textContent = routeName(inspectedRoute);
  if (state.closedRoutes.includes(inspectedRoute)) {
    routeInfoDescription.textContent = "Участок уже закрыт.";
    routeInfoForecast.textContent = "Закрыт с " + firstClosedTurn + "-го хода.";
    return;
  }

  const remaining = firstClosedTurn - state.turn;
  routeInfoDescription.textContent = lastOpenTurn >= scenario.maxTurns
    ? "Открыт до конца партии."
    : remaining === 1 ? "Закроется после этого хода."
    : "Закроется через " + remaining + (remaining < 5 ? " хода." : " ходов.");
  routeInfoForecast.textContent = "Последний проезд: ход " + lastOpenTurn + ".";
}

function availableDestinations(vehicle: VehicleId): NodeId[] {
  if (state.endReason !== null) return [];
  const from = state.vehicles[vehicle].node;
  const destinations: NodeId[] = [];
  for (const { id, ends: [a, b], vehicleKind } of scenario.routes) {
    if (vehicleKind !== vehicles[vehicle].kind || state.closedRoutes.includes(id)) continue;
    if (from === a) destinations.push(b);
    if (from === b) destinations.push(a);
  }
  return destinations;
}

function unassignedVehicles() {
  return scenario.vehicleIds.filter((id) => moves[id] === undefined && availableDestinations(id).length > 0);
}

function isDecisionTurn() {
  return state.endReason === null && state.turn === scenario.decisionTurn && state.floodgate === null;
}

function turnOrders(): TurnOrders {
  return isDecisionTurn() ? { moves, floodgate: draftFloodgate } : { moves };
}

function selectVehicle(id: VehicleId | null) {
  if (resolving || state.endReason !== null || (id === null && selected === null)) return;
  if (guideStep && (guideStep.kind !== "vehicle" || guideStep.id !== id)) return;
  selected = id;
  render();
}

function assign(destination: NodeId | null) {
  if (resolving || state.endReason !== null || selected === null) return;
  if (guideStep && (guideStep.kind !== "destination" || guideStep.id !== destination)) return;
  if (destination !== null && !availableDestinations(selected).includes(destination)) return;
  moves = { ...moves, [selected]: destination };
  sounds.play("order");
  render();
}

const vehicleGroup = document.querySelector("#vehicles")!;
const selectedRoutes = document.querySelector("#selected-routes")!;
for (const id of vehicleIds) {
  const button = makeButton(vehicleGroup, "", () => selectVehicle(id));
  button.setAttribute("aria-label", vehicleName(id));
  vehicleButtons.set(id, button);
  const item = document.createElement("li");
  item.id = id + "-order";
  item.className = "vehicle-order";
  selectedRoutes.append(item);
  plannedRoutes.set(id, item);
}

const destinationGroup = document.querySelector("#destinations")!;
for (const id of nodeIds) {
  destinationButtons.set(id, makeButton(destinationGroup, nodes[id].label, () => assign(id)));
}
const wait = document.querySelector<HTMLButtonElement>("#wait-order")!;
wait.addEventListener("click", () => assign(null));

for (const route of routes) {
  if (route.lastOpenTurn === null) continue;
  const item = document.createElement("li");
  const label = document.createElement("strong");
  label.textContent = route.label;
  const status = document.createElement("span");
  item.append(label, status);
  routeList.append(item);
  routeItems.set(route.id, { item, status });
}

function forecastFor(level: Scenario) {
  return { closed: getRouteForecast("closed", level), open: getRouteForecast("open", level) };
}

function updateFloodgateTimings() {
  for (const mode of forecastModes) {
    const timing = document.querySelector("#floodgate-" + mode + "-timing")!;
    const [bridgeTurn, ferryTurn] = forecastCrossings.map(
      (id) => forecasts[mode].find(({ route }) => route === id)?.lastOpenTurn,
    );
    if (bridgeTurn == null || ferryTurn == null) {
      timing.replaceChildren();
      continue;
    }
    const bridgeTiming = scenario !== firstScenario
      ? `Мост · по ${bridgeTurn}-й ход`
      : bridgeTurn === scenario.maxTurns
        ? `Мост останется открыт до конца ${bridgeTurn}-го хода.`
        : `Мост разрушится после ${bridgeTurn}-го хода.`;
    const ferryTiming = scenario === firstScenario
      ? `Паром перестанет ходить после ${ferryTurn}-го хода.`
      : `Паром · по ${ferryTurn}-й ход`;
    timing.replaceChildren(bridgeTiming, document.createElement("br"), ferryTiming);
  }
}
updateFloodgateTimings();

for (const input of floodgateInputs) {
  input.addEventListener("change", () => {
    if (resolving || !isDecisionTurn() || !input.checked) return;
    draftFloodgate = input.value === "open" ? "open" : "closed";
    if (draftFloodgate === "closed") comparedForecasts = true;
    render();
  });
}

function renderFloodgateChoice() {
  floodgateChoice.hidden = !isDecisionTurn();
  floodgateInstruction.hidden = scenario !== firstScenario;
  if (scenario === firstScenario) floodgateChoice.setAttribute("aria-describedby", floodgateInstruction.id);
  else floodgateChoice.setAttribute("aria-describedby", lessonInstruction.id);
  for (const input of floodgateInputs) input.checked = input.value === draftFloodgate;
  floodgateChoice.disabled = resolving;
}

function describeNextStep() {
  if (state.turn === 1) {
    return "Назначь маршруты автобусам и парому, затем выполни ход. Пустой транспорт забирает до 18 человек сразу по прибытии.";
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

function renderLessonGuide(step: LessonStep | null) {
  const lesson = lessons[lessonIndex];
  lessonGuide.hidden = skipLessons.hidden = !lesson;
  replayLessons.hidden = Boolean(lesson);
  skipLessons.disabled = resolving;
  replayLessons.disabled = resolving;
  gameGoal.textContent = lesson?.goal ?? gameGoalText;
  const advanceParent = lesson ? lessonActions : planning;
  if (advance.parentElement !== advanceParent) advanceParent.append(advance);
  if (lesson) lessonTitle.textContent = `Урок ${lessonIndex + 1} из ${lessons.length} · ${lesson.title}`;
  const text = resolving && lesson ? "Транспорт выполняет приказ." : step?.text ?? "";
  if (text !== previousGuide) {
    lessonInstruction.textContent = text;
    previousGuide = text;
  }
  advance.hidden = Boolean(lesson && step?.kind !== "advance");
  lessonNext.hidden = step?.kind !== "next";
  if (!lessonNext.hidden) {
    lessonNext.textContent = lessonIndex + 1 < lessons.length ? "Следующий урок" : "Начать тестовый уровень";
  }
  planning.parentElement!.hidden = step?.kind === "next";
  lessonArrow.hidden = true;
  lessonMapAction.hidden = true;
  let target: HTMLElement | null = null;
  if (step && !resolving) {
    if (step.kind === "vehicle" || step.kind === "destination") {
      const point = step.kind === "vehicle" ? scene.vehiclePosition(step.id) : nodes[step.id];
      placeOnMap(lessonArrow, [point.x, point.y]);
      lessonArrow.hidden = false;
      lessonMapAction.textContent = step.kind === "vehicle"
        ? "Выбрать " + (vehicles[step.id].kind === "bus" ? "автобус " + vehicles[step.id].label : "паром")
        : "Назначить маршрут · " + nodes[step.id].label;
      lessonMapAction.hidden = false;
    } else if (step.kind === "floodgate") {
      target = floodgateInputs.find(({ value }) => value === step.id)!.closest("label");
    } else {
      target = step.kind === "advance" ? advance : lessonNext;
    }
  }
  if (target !== guideControl) {
    guideControl?.classList.remove("lesson-target");
    target?.classList.add("lesson-target");
    guideControl = target;
  }
}

function render() {
  const lesson = lessons[lessonIndex];
  guideStep = lesson ? lessonStep(lesson, state, selected, moves, draftFloodgate, comparedForecasts) : null;
  const available = guideStep
    ? (guideStep.kind === "destination" ? [guideStep.id] : [])
    : selected === null ? [] : availableDestinations(selected);
  const selectedOrder = selected === null ? undefined : moves[selected];
  const issues = validateTurn(state, turnOrders(), scenario);
  const conflicts = issues.filter((issue) => issue.kind === "route-capacity");
  const needsFloodgate = issues.some((issue) => issue.kind === "floodgate-choice-required");
  renderFloodgateChoice();
  const forecastMode = state.floodgate ?? draftFloodgate ?? "closed";
  const finished = state.endReason !== null;
  const report = getEvacuationReport(state, scenario);
  const unassigned = unassignedVehicles();

  turnNumber.textContent = String(state.turn);
  score.textContent = report.total.evacuated + " / " + report.total.initial;
  orderCount.textContent = (scenario.vehicleIds.length - unassigned.length) + " из " + scenario.vehicleIds.length + " готовы";
  mapContext.textContent = finished ? "Эвакуация завершена" : resolving ? "Транспорт в пути"
    : selected === null ? "Выбери автобус или паром" : "Выбран транспорт · " + vehicleName(selected);
  mapContext.hidden = Boolean(lesson && !resolving);
  for (const [district, count] of queueCounts) {
    count.data = String(report.districts[district].waiting);
    queueRows.get(district)!.hidden = scenario.initialWaiting[district] === 0;
  }
  planning.hidden = finished;
  result.hidden = !finished || Boolean(lesson);
  const guide = lesson ? "" : describeNextStep();
  turnGuide.textContent = guide;
  turnGuide.hidden = !guide;

  for (const id of vehicleIds) {
    const button = vehicleButtons.get(id)!;
    const current = state.vehicles[id];
    const destination = moves[id];
    const planned = destination !== undefined;
    const conflict = conflicts.some((issue) => issue.vehicles.includes(id));
    const title = document.createElement("strong");
    const icon = document.createElement("span");
    icon.className = "asset-icon icon-" + vehicles[id].kind;
    icon.setAttribute("aria-hidden", "true");
    title.append(icon, vehicleName(id));
    const location = document.createElement("span");
    location.className = "vehicle-location";
    location.textContent = nodes[current.node].label;
    const occupancy = document.createElement("span");
    occupancy.className = "vehicle-occupancy";
    const passengerCount = (current.passengers?.count ?? 0) + "/" + vehicles[id].seats;
    const occupancyDescription = document.createElement("span");
    occupancyDescription.className = "sr-only";
    occupancyDescription.textContent = " мест занято";
    occupancy.append(passengerCount, occupancyDescription);
    const order = plannedRoutes.get(id)!;
    const active = scenario.vehicleIds.includes(id);
    button.hidden = order.hidden = !active;
    const automaticWait = !planned && !unassigned.includes(id);
    const route = document.createElement("span");
    route.textContent = destination ? nodes[current.node].label + " → " + nodes[destination].label
      : planned ? "Ждать" : automaticWait ? "Ждёт автоматически" : "Без приказа";
    if (conflict) route.textContent += " · конфликт на мосту";
    if (planned) {
      const checkmark = document.createElement("span");
      checkmark.setAttribute("aria-hidden", "true");
      checkmark.textContent = "✓ ";
      route.prepend(checkmark);
    }
    const name = document.createElement("strong");
    name.textContent = vehicles[id].kind === "ferry" ? "Паром" : vehicles[id].label;
    order.replaceChildren(name, route);
    order.classList.toggle("planned", planned);
    order.classList.toggle("conflict", conflict);
    button.replaceChildren(title, occupancy, location);
    button.disabled = resolving || Boolean(guideStep && (guideStep.kind !== "vehicle" || guideStep.id !== id));
    button.setAttribute("aria-pressed", String(id === selected));
    location.id = id + "-location";
    occupancy.id = id + "-occupancy";
    const description = location.id + " " + occupancy.id + " " + order.id;
    button.setAttribute("aria-describedby", conflict ? description + " order-status" : description);
    button.classList.toggle("planned", planned);
    button.classList.toggle("conflict", conflict);
  }

  destinationGroup.setAttribute("aria-label", selected === null ? "Назначить маршрут" : "Назначить маршрут · " + vehicleName(selected));
  for (const [id, button] of destinationButtons) {
    button.hidden = !available.includes(id);
    button.disabled = resolving;
    button.setAttribute("aria-pressed", String(selectedOrder === id));
  }
  wait.setAttribute("aria-pressed", String(selectedOrder === null));

  wait.disabled = resolving || Boolean(lesson) || available.length === 0;
  wait.title = selected === null ? "Сначала выбери транспорт" : "Оставить на месте · " + vehicleName(selected);
  advance.disabled = resolving || finished || issues.length > 0 || Boolean(guideStep && guideStep.kind !== "advance");
  advance.classList.toggle("awaiting-floodgate", needsFloodgate);
  advance.textContent = resolving ? "Выполняется ход…" : needsFloodgate ? "Выполнить ход · выбери водосброс" : "Выполнить ход";
  if (needsFloodgate) {
    orderStatus.textContent = "Чтобы выполнить ход, выбери режим водосброса над картой.";
  } else if (conflicts.length) {
    orderStatus.textContent = "На мосту два приказа. Измени маршрут одного автобуса.";
  } else if (selected === null || selectedOrder !== undefined) {
    orderStatus.textContent = "";
  } else {
    orderStatus.textContent = available.length
      ? "Выбери подсвеченный пункт на карте."
      : "Открытых маршрутов нет. Транспорт ждёт автоматически.";
  }
  orderStatus.classList.toggle("error", conflicts.length > 0);

  for (const [route, entry] of routeItems) {
    const lastOpenTurn = forecasts[forecastMode].find((forecast) => forecast.route === route)?.lastOpenTurn ?? null;
    entry.item.hidden = lastOpenTurn === null;
    const closed = state.closedRoutes.includes(route);
    const lastChance = !closed && lastOpenTurn === state.turn;
    entry.status.textContent = closed ? "Закрыто" : lastChance ? "Последний ход" : lastOpenTurn === null ? "" : "По " + lastOpenTurn + "-й ход";
    entry.item.classList.toggle("closed", closed);
    entry.item.classList.toggle("last-chance", lastChance);
    const label = routeLabelButtons.get(route);
    if (label) {
      label.button.hidden = !scenario.routes.some(({ id }) => id === route);
      const conflict = conflicts.some((issue) => issue.route === route);
      label.button.classList.toggle("route-warning", closed || conflict);
      label.badge.textContent = closed ? " ×" : conflict ? " !" : "";
    }
  }
  routeList.toggleAttribute("hidden", !scenario.routes.some(({ lastOpenTurn }) => lastOpenTurn !== null));
  renderRouteInfo();

  scene.renderState({
    scenario, state, moves, selected, available, resolving,
    conflicts: conflicts.map((issue) => issue.route),
  });
  renderLessonGuide(guideStep);
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
  const { districts, total } = getEvacuationReport(state, scenario);
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

function preventRepeatedEnter(event: KeyboardEvent) {
  if (event.key === "Enter" && event.repeat) event.preventDefault();
}

advance.addEventListener("keydown", preventRepeatedEnter);
unassignedDialog.addEventListener("keydown", preventRepeatedEnter);

advance.addEventListener("click", (event) => {
  if (advance.disabled || resolving || unassignedDialog.open || event.detail > 1) return;
  const unassigned = unassignedVehicles();
  if (unassigned.length) {
    const names = unassigned.map(vehicleName).join(", ");
    unassignedMessage.textContent = "Без приказа: " + names + ". Этот транспорт останется на месте.";
    unassignedDialog.showModal();
    return;
  }
  void executeTurn();
});

confirmAdvance.addEventListener("click", (event) => {
  if (!unassignedDialog.open || event.detail > 1) return;
  unassignedDialog.close();
  void executeTurn();
});

async function executeTurn() {
  const turn = state.turn;
  const next = advanceTurn(state, turnOrders(), scenario);
  if (!next.ok) return;
  selected = null;
  const restoreFocus = document.activeElement === advance;
  if (!reduceMotion.matches && next.events.some((event) => event.kind === "moved")) {
    resolving = true;
    render();
    await scene.animateTurn(scenario, next.events, next.state, () => {
      mapContext.textContent = "Идёт посадка";
    });
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
    if (lessons[lessonIndex]) lessonNext.focus();
    else showResult(state.endReason);
  } else if (lessons[lessonIndex] && restoreFocus && (document.activeElement === document.body || document.activeElement === advance)) {
    lessonMapAction.focus({ preventScroll: true });
  } else if (isDecisionTurn()) {
    floodgateTitle.focus({ preventScroll: true });
    floodgateChoice.scrollIntoView({ block: "nearest" });
  } else if (restoreFocus && (document.activeElement === document.body || document.activeElement === advance)) {
    advance.focus();
  }
}

function resetLevel() {
  closeRouteInfo();
  state = createInitialState(scenario);
  draftFloodgate = undefined;
  comparedForecasts = false;
  moves = {};
  selected = null;
  journal.replaceChildren();
  turnFeedback.replaceChildren();
  journalEmpty.hidden = false;
  render();
}

restart.addEventListener("click", () => {
  resetLevel();
  vehicleButtons.get(vehicleIds[0])!.focus({ preventScroll: true });
});
skipLessons.addEventListener("click", () => setLevel(lessons.length));
replayLessons.addEventListener("click", () => {
  gameHelp.close();
  setLevel(0);
});
lessonMapAction.addEventListener("keydown", preventRepeatedEnter);
lessonMapAction.addEventListener("click", (event) => {
  if (event.detail > 1) return;
  if (guideStep?.kind === "vehicle") selectVehicle(guideStep.id);
  else if (guideStep?.kind === "destination") assign(guideStep.id);
  if (lessonMapAction.hidden && !advance.hidden) advance.focus({ preventScroll: true });
});
lessonNext.addEventListener("keydown", preventRepeatedEnter);
lessonNext.addEventListener("click", (event) => {
  if (event.detail <= 1) setLevel(lessonIndex + 1);
});

const scene = new MapPreview(assign, selectVehicle, () => {
  loading.hidden = true;
  render();
  routeLabels.hidden = false;
  shelterCount.hidden = false;
});

async function startGame() {
  // Phaser draws labels to textures, so load the font before creating the scene.
  await document.fonts.load('700 38px "Bridge Inter"', "Убежище").catch(() => []);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: mapElement,
    width: map.width,
    height: map.height,
    backgroundColor: "#f1f0e8",
    scene,
    input: { windowEvents: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    banner: false,
    audio: { noAudio: true },
  });
  // Page layout can move the canvas without resizing it.
  const updateMapBounds = () => game.scale.updateBounds();
  for (const event of ["mouseover", "mousedown", "mouseup", "touchstart", "touchend"]) {
    mapElement.addEventListener(event, updateMapBounds, { capture: true, passive: true });
  }
}

void startGame();
