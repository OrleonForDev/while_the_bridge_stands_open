import Phaser from "phaser";
import { MapPreview } from "./map-preview";
import { districtIds, firstScenario, vehicleIds } from "./game/scenario.ts";
import type { NodeId, ScenarioRouteId, VehicleId } from "./game/scenario.ts";
import { advanceTurn, createInitialState, getEvacuationReport, getRouteForecast, validateTurn } from "./game/turn.ts";
import type { EndReason, TurnEvent, TurnOrders } from "./game/turn.ts";
import "./style.css";

const { map, nodes, routes, vehicles } = firstScenario;
const nodeIds = Object.keys(nodes) as NodeId[];

const mapElement = document.querySelector<HTMLDivElement>("#map")!;
const planning = document.querySelector<HTMLElement>("#planning")!;
const result = document.querySelector<HTMLElement>("#result")!;
const resultTitle = document.querySelector<HTMLHeadingElement>("#result-title")!;
const loading = document.querySelector<HTMLElement>("#loading")!;
const advance = document.querySelector<HTMLButtonElement>("#advance")!;
const restart = document.querySelector<HTMLButtonElement>("#restart")!;
const orderStatus = document.querySelector<HTMLElement>("#order-status")!;
const turnNumber = document.querySelector<HTMLElement>("#turn-number")!;
const score = document.querySelector<HTMLElement>("#score")!;
const resultScore = document.querySelector<HTMLElement>("#result-score")!;
const resultReason = document.querySelector<HTMLElement>("#result-reason")!;
const resultRows = document.querySelector<HTMLTableSectionElement>("#district-results")!;
const journal = document.querySelector<HTMLOListElement>("#journal")!;
const journalEmpty = document.querySelector<HTMLElement>("#journal-empty")!;

let state = createInitialState();
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

function turnOrders(): TurnOrders {
  return state.turn === firstScenario.decisionTurn ? { moves, floodgate: "closed" } : { moves };
}

function selectVehicle(id: VehicleId) {
  if (state.endReason !== null) return;
  selected = id;
  render();
}

function assign(destination: NodeId | null) {
  if (state.endReason !== null) return;
  if (destination !== null && !availableDestinations(selected).includes(destination)) return;
  moves = { ...moves, [selected]: destination };
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

function render() {
  const available = availableDestinations(selected);
  const conflicts = validateTurn(state, turnOrders()).filter((issue) => issue.kind === "route-capacity");
  const finished = state.endReason !== null;
  const report = getEvacuationReport(state);

  turnNumber.textContent = String(state.turn);
  score.textContent = report.total.evacuated + " / " + report.total.initial;
  planning.hidden = finished;
  result.hidden = !finished;

  for (const id of vehicleIds) {
    const button = vehicleButtons.get(id)!;
    const current = state.vehicles[id];
    const destination = moves[id];
    const conflict = conflicts.some((issue) => issue.vehicles.includes(id));
    const title = document.createElement("strong");
    title.textContent = vehicleName(id);
    const location = document.createElement("span");
    location.textContent = nodes[current.node].label + " · " + (current.passengers?.count ?? 0) + "/" + vehicles[id].seats + " мест занято";
    const order = document.createElement("span");
    order.textContent = destination ? "→ " + nodes[destination].label : "Ждать";
    if (conflict) order.textContent += " · конфликт на мосту";
    button.replaceChildren(title, location, order);
    button.setAttribute("aria-pressed", String(id === selected));
    button.classList.toggle("conflict", conflict);
    if (conflict) button.setAttribute("aria-describedby", "order-status");
    else button.removeAttribute("aria-describedby");
  }

  destinationGroup.setAttribute("aria-label", "Назначить маршрут · " + vehicleName(selected));
  for (const [id, button] of destinationButtons) {
    button.hidden = !available.includes(id);
    button.setAttribute("aria-pressed", String(moves[selected] === id));
  }
  wait.setAttribute("aria-pressed", String(!moves[selected]));

  advance.disabled = finished || conflicts.length > 0;
  orderStatus.textContent = conflicts.length
    ? "На мосту два приказа. Измени маршрут одного автобуса."
    : available.length ? "Выбери соседний узел на карте или в списке." : "Для этого транспорта открытых маршрутов нет.";
  orderStatus.classList.toggle("error", conflicts.length > 0);

  for (const { route, lastOpenTurn } of getRouteForecast(state.floodgate ?? "closed")) {
    const item = routeItems.get(route);
    if (!item) continue;
    const closed = state.closedRoutes.includes(route);
    item.textContent = routeName(route) + " · " + (closed ? "закрыт" : "последний ход " + lastOpenTurn);
    item.classList.toggle("closed", closed);
  }

  scene.renderState({ state, moves, selected, available, conflicts: conflicts.map((issue) => issue.route) });
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
      return "Водосброс оставлен закрытым.";
    case "game-ended":
      return null;
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

advance.addEventListener("click", (event) => {
  // A mouse double-click must not confirm the newly opened turn.
  if (event.detail > 1) return;
  const turn = state.turn;
  const next = advanceTurn(state, turnOrders());
  if (!next.ok) return;
  state = next.state;
  moves = {};
  addJournalEntries(next.events, turn);
  render();
  if (state.endReason !== null) showResult(state.endReason);
});

restart.addEventListener("click", () => {
  state = createInitialState();
  moves = {};
  selected = "bus-1";
  journal.replaceChildren();
  journalEmpty.hidden = false;
  render();
  vehicleButtons.get(selected)!.focus();
});

const scene = new MapPreview(assign, selectVehicle, () => {
  loading.hidden = true;
  render();
});

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
