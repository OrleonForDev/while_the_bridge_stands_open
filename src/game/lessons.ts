import { firstScenario } from "./scenario.ts";
import type { Scenario } from "./scenario.ts";

const [bridge, crossing, , , schoolRoad] = firstScenario.routes;

export const busLesson = {
  ...firstScenario,
  decisionTurn: null,
  maxTurns: 3,
  initialWaiting: { hospital: 0, school: 18, embankment: 0 },
  vehicleIds: ["bus-1"],
  routes: [{ ...bridge, lastOpenTurn: null }, schoolRoad],
} as const satisfies Scenario;

export const floodgateLesson = {
  ...firstScenario,
  decisionTurn: 1,
  maxTurns: 2,
  initialWaiting: { hospital: 0, school: 18, embankment: 18 },
  vehicles: {
    ...firstScenario.vehicles,
    ferry: { ...firstScenario.vehicles.ferry, startNode: "embankment" },
  },
  vehicleIds: ["bus-2", "ferry"],
  routes: [
    { ...bridge, lastOpenTurn: { closed: 1, open: 2 } },
    { ...crossing, lastOpenTurn: { closed: 2, open: 1 } },
    schoolRoad,
  ],
} as const satisfies Scenario;
