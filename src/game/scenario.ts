export const districtIds = ["hospital", "school", "embankment"] as const;
export type DistrictId = (typeof districtIds)[number];
export type NodeId = DistrictId | "shelter" | "junction";

export const vehicleIds = ["bus-1", "bus-2", "ferry"] as const;
export type VehicleId = (typeof vehicleIds)[number];
type VehicleKind = "bus" | "ferry";

export type FloodgateMode = "closed" | "open";
type RouteId = "bridge" | "ferry-crossing" | "lower-road" | "hospital-road" | "school-road";

type MapNode = {
  label: string;
  symbol: string;
  x: number;
  y: number;
};

type Route = {
  readonly id: RouteId;
  readonly label: string;
  readonly ends: readonly [NodeId, NodeId];
  readonly vehicleKind: VehicleKind;
  readonly maxVehiclesPerTurn: number | null;
  readonly lastOpenTurn: Readonly<Record<FloodgateMode, number>> | null;
};

type Vehicle = {
  label: string;
  kind: VehicleKind;
  seats: number;
  startNode: NodeId;
};

export const firstScenario = {
  map: { width: 1740, height: 840 },
  shelter: "shelter",
  decisionTurn: 3,
  maxTurns: 8,
  nodes: {
    shelter: { label: "Убежище", symbol: "У", x: 286, y: 378 },
    junction: { label: "Развязка", symbol: "Р", x: 1012, y: 378 },
    hospital: { label: "Больница", symbol: "Б", x: 1250, y: 148 },
    school: { label: "Школа", symbol: "Ш", x: 1482, y: 378 },
    embankment: { label: "Набережная", symbol: "Н", x: 1212, y: 676 },
  } satisfies Record<NodeId, MapNode>,
  initialWaiting: { hospital: 36, school: 18, embankment: 54 } satisfies Record<DistrictId, number>,
  vehicles: {
    "bus-1": { label: "А1", kind: "bus", seats: 18, startNode: "junction" },
    "bus-2": { label: "А2", kind: "bus", seats: 18, startNode: "school" },
    ferry: { label: "П", kind: "ferry", seats: 18, startNode: "shelter" },
  } satisfies Record<VehicleId, Vehicle>,
  routes: [
    {
      id: "bridge", label: "Мост", ends: ["junction", "shelter"],
      vehicleKind: "bus", maxVehiclesPerTurn: 1, lastOpenTurn: { closed: 4, open: 7 },
    },
    {
      id: "ferry-crossing", label: "Переправа", ends: ["embankment", "shelter"],
      vehicleKind: "ferry", maxVehiclesPerTurn: null, lastOpenTurn: { closed: 6, open: 4 },
    },
    {
      id: "lower-road", label: "Нижняя дорога", ends: ["junction", "embankment"],
      vehicleKind: "bus", maxVehiclesPerTurn: null, lastOpenTurn: { closed: 3, open: 3 },
    },
    {
      id: "hospital-road", label: "Дорога к больнице", ends: ["junction", "hospital"],
      vehicleKind: "bus", maxVehiclesPerTurn: null, lastOpenTurn: null,
    },
    {
      id: "school-road", label: "Дорога к школе", ends: ["junction", "school"],
      vehicleKind: "bus", maxVehiclesPerTurn: null, lastOpenTurn: null,
    },
  ] satisfies readonly Route[],
} as const;

export type ScenarioRoute = (typeof firstScenario.routes)[number];
export type ScenarioRouteId = ScenarioRoute["id"];
