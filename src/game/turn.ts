import { districtIds, firstScenario } from "./scenario.ts";
import type {
  DistrictId, FloodgateMode, NodeId, Scenario, ScenarioRouteId, VehicleId,
} from "./scenario.ts";

type DistrictCounts = Readonly<Record<DistrictId, number>>;
type Passengers = Readonly<{ district: DistrictId; count: number }>;

type VehicleState = Readonly<{
  node: NodeId;
  passengers: Passengers | null;
}>;

export type EndReason = "all-evacuated" | "shelter-isolated" | "turn-limit";

export type GameState = Readonly<{
  turn: number;
  floodgate: FloodgateMode | null;
  closedRoutes: readonly ScenarioRouteId[];
  vehicles: Readonly<Record<VehicleId, VehicleState>>;
  waiting: DistrictCounts;
  evacuated: DistrictCounts;
  endReason: EndReason | null;
}>;

export type TurnOrders = Readonly<{
  moves?: Readonly<Partial<Record<VehicleId, NodeId | null>>>;
  floodgate?: FloodgateMode;
}>;

export type TurnIssue =
  | { kind: "game-finished" | "floodgate-choice-required" | "unexpected-floodgate-choice" }
  | { kind: "not-adjacent"; vehicle: VehicleId; destination: NodeId }
  | { kind: "wrong-vehicle" | "route-closed"; vehicle: VehicleId; route: ScenarioRouteId }
  | { kind: "route-capacity"; route: ScenarioRouteId; vehicles: readonly VehicleId[] };

export type TurnEvent =
  | { kind: "floodgate-chosen"; turn: number; mode: FloodgateMode }
  | { kind: "boarded"; turn: number; vehicle: VehicleId; passengers: Passengers }
  | { kind: "evacuated"; turn: number; vehicle: VehicleId; passengers: Passengers }
  | { kind: "moved"; turn: number; vehicle: VehicleId; route: ScenarioRouteId; from: NodeId; to: NodeId }
  | { kind: "route-closed"; turn: number; route: ScenarioRouteId }
  | { kind: "game-ended"; turn: number; reason: EndReason };

export type TurnResult =
  | { ok: true; state: GameState; events: readonly TurnEvent[] }
  | { ok: false; state: GameState; events: readonly []; issues: readonly TurnIssue[] };

type PlannedMove = {
  vehicle: VehicleId;
  route: Scenario["routes"][number];
  from: NodeId;
  to: NodeId;
};

export function createInitialState(scenario: Scenario = firstScenario): GameState {
  const waiting = { ...scenario.initialWaiting };
  const atStart = (id: VehicleId): VehicleState => {
    const node = scenario.vehicles[id].startNode;
    const passengers = scenario.vehicleIds.includes(id) ? boardAt(scenario, waiting, id, node) : null;
    return { node, passengers };
  };

  return {
    turn: 1,
    floodgate: null,
    closedRoutes: [],
    vehicles: { "bus-1": atStart("bus-1"), "bus-2": atStart("bus-2"), ferry: atStart("ferry") },
    waiting,
    evacuated: { hospital: 0, school: 0, embankment: 0 },
    endReason: null,
  };
}

export function getRouteForecast(mode: FloodgateMode, scenario: Scenario = firstScenario) {
  return scenario.routes.map((route) => {
    const lastOpenTurn = route.lastOpenTurn?.[mode] ?? null;
    return {
      route: route.id,
      lastOpenTurn,
      firstClosedTurn: lastOpenTurn === null ? null : lastOpenTurn + 1,
    };
  });
}

export function getEvacuationReport(state: GameState, scenario: Scenario = firstScenario) {
  function districtReport(district: DistrictId) {
    let inTransit = 0;
    for (const id of scenario.vehicleIds) {
      const passengers = state.vehicles[id].passengers;
      if (passengers?.district === district) inTransit += passengers.count;
    }
    return {
      initial: scenario.initialWaiting[district],
      evacuated: state.evacuated[district],
      waiting: state.waiting[district],
      inTransit,
    };
  }

  const districts = {
    hospital: districtReport("hospital"),
    school: districtReport("school"),
    embankment: districtReport("embankment"),
  };
  const total = { initial: 0, evacuated: 0, waiting: 0, inTransit: 0 };
  for (const district of districtIds) {
    const counts = districts[district];
    total.initial += counts.initial;
    total.evacuated += counts.evacuated;
    total.waiting += counts.waiting;
    total.inTransit += counts.inTransit;
  }
  return { districts, total };
}

function checkOrders(scenario: Scenario, state: GameState, orders: TurnOrders) {
  const moves: PlannedMove[] = [];
  const issues: TurnIssue[] = [];

  if (state.endReason !== null) {
    return { moves, issues: [{ kind: "game-finished" }] satisfies TurnIssue[] };
  }

  if (state.turn === scenario.decisionTurn) {
    if (orders.floodgate !== "closed" && orders.floodgate !== "open") {
      issues.push({ kind: "floodgate-choice-required" });
    }
  } else if (orders.floodgate !== undefined) {
    issues.push({ kind: "unexpected-floodgate-choice" });
  }

  for (const vehicle of scenario.vehicleIds) {
    const to = orders.moves?.[vehicle];
    if (to === undefined || to === null) continue;

    const from = state.vehicles[vehicle].node;
    const route = scenario.routes.find(({ ends: [a, b] }) =>
      (from === a && to === b) || (from === b && to === a)
    );
    if (!route) {
      issues.push({ kind: "not-adjacent", vehicle, destination: to });
    } else if (route.vehicleKind !== scenario.vehicles[vehicle].kind) {
      issues.push({ kind: "wrong-vehicle", vehicle, route: route.id });
    } else if (state.closedRoutes.includes(route.id)) {
      issues.push({ kind: "route-closed", vehicle, route: route.id });
    } else {
      moves.push({ vehicle, route, from, to });
    }
  }

  for (const { id, maxVehiclesPerTurn } of scenario.routes) {
    if (maxVehiclesPerTurn === null) continue;
    const vehicles = moves.filter(({ route }) => route.id === id).map(({ vehicle }) => vehicle);
    if (vehicles.length > maxVehiclesPerTurn) {
      issues.push({ kind: "route-capacity", route: id, vehicles });
    }
  }
  return { moves, issues };
}

export function validateTurn(state: GameState, orders: TurnOrders = {}, scenario: Scenario = firstScenario): readonly TurnIssue[] {
  return checkOrders(scenario, state, orders).issues;
}

function isDistrict(node: NodeId): node is DistrictId {
  return districtIds.some((district) => district === node);
}

function boardAt(scenario: Scenario, waiting: Record<DistrictId, number>, vehicle: VehicleId, node: NodeId): Passengers | null {
  if (!isDistrict(node)) return null;
  const count = Math.min(waiting[node], scenario.vehicles[vehicle].seats);
  if (count === 0) return null;

  waiting[node] -= count;
  return { district: node, count };
}

function finishOrOpenNextTurn(scenario: Scenario, state: GameState, events: TurnEvent[]): GameState {
  function finish(snapshot: GameState, reason: EndReason): GameState {
    events.push({ kind: "game-ended", turn: snapshot.turn, reason });
    return { ...snapshot, endReason: reason };
  }

  if (districtIds.every((district) => state.evacuated[district] === scenario.initialWaiting[district])) {
    return finish(state, "all-evacuated");
  }
  if (state.turn >= scenario.maxTurns) return finish(state, "turn-limit");

  const turn = state.turn + 1;
  const closedRoutes = [...state.closedRoutes];

  for (const { route, firstClosedTurn } of getRouteForecast(state.floodgate ?? "closed", scenario)) {
    if (firstClosedTurn !== null && turn >= firstClosedTurn && !closedRoutes.includes(route)) {
      closedRoutes.push(route);
      events.push({ kind: "route-closed", turn, route });
    }
  }

  const next = { ...state, turn, closedRoutes };
  const shelterHasAccess = scenario.routes.some(({ id, ends }) =>
    ends.includes(scenario.shelter) && !closedRoutes.includes(id)
  );
  return shelterHasAccess ? next : finish(next, "shelter-isolated");
}

export function advanceTurn(state: GameState, orders: TurnOrders = {}, scenario: Scenario = firstScenario): TurnResult {
  const { moves, issues } = checkOrders(scenario, state, orders);
  if (issues.length > 0) return { ok: false, state, events: [], issues };

  const { turn } = state;
  const floodgate = orders.floodgate ?? state.floodgate;
  const waiting = { ...state.waiting };
  const evacuated = { ...state.evacuated };
  const vehicles = { ...state.vehicles };
  const events: TurnEvent[] = [];

  if (orders.floodgate !== undefined) {
    events.push({ kind: "floodgate-chosen", turn, mode: orders.floodgate });
  }

  for (const { vehicle, route, from, to } of moves) {
    vehicles[vehicle] = { ...vehicles[vehicle], node: to };
    events.push({ kind: "moved", turn, vehicle, route: route.id, from, to });
  }

  // Simultaneous arrivals share the queue in vehicle priority order.
  for (const { vehicle, to } of moves) {
    if (vehicles[vehicle].passengers !== null) continue;
    const passengers = boardAt(scenario, waiting, vehicle, to);
    if (passengers === null) continue;

    vehicles[vehicle] = { node: to, passengers };
    events.push({ kind: "boarded", turn, vehicle, passengers });
  }

  for (const { vehicle, to } of moves) {
    const passengers = vehicles[vehicle].passengers;
    if (to !== scenario.shelter || passengers === null) continue;

    evacuated[passengers.district] += passengers.count;
    vehicles[vehicle] = { ...vehicles[vehicle], passengers: null };
    events.push({ kind: "evacuated", turn, vehicle, passengers });
  }

  const snapshot = { ...state, floodgate, waiting, evacuated, vehicles };
  return { ok: true, state: finishOrOpenNextTurn(scenario, snapshot, events), events };
}
