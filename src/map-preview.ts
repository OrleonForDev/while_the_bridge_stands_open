import Phaser from "phaser";
import { firstScenario, districtIds, vehicleIds } from "./game/scenario.ts";
import type { FloodgateMode, NodeId, ScenarioRouteId, VehicleId } from "./game/scenario.ts";
import type { GameState, TurnOrders } from "./game/turn.ts";

const { map, nodes, routes } = firstScenario;
const nodeIds = Object.keys(nodes) as NodeId[];
const ink = 0x243b39;
const accent = 0x0c7565;
const blocked = 0x983825;
const paper = 0xf3eee1;
const fontFamily = '"Inter", "Segoe UI", sans-serif';

type Point = { x: number; y: number };
type MapView = {
  state: GameState;
  moves: NonNullable<TurnOrders["moves"]>;
  selected: VehicleId;
  available: readonly NodeId[];
  forecastMode: FloodgateMode;
  conflicts: readonly ScenarioRouteId[];
};
type NodeMarker = {
  marker: Phaser.GameObjects.Arc;
  zone: Phaser.GameObjects.Zone;
  queue: Phaser.GameObjects.Text;
};

function points(coords: readonly [number, number][]) {
  return coords.map(([x, y]) => new Phaser.Math.Vector2(x, y));
}

const westBank = points([[550, 0], [530, 108], [552, 212], [586, 330], [565, 440], [519, 551], [518, 679], [558, map.height]]);
const eastBank = points([[810, 0], [776, 118], [801, 230], [836, 349], [816, 455], [772, 576], [784, 704], [828, map.height]]);

const routeLabels = {
  bridge: { x: 679, y: 317 },
  "ferry-crossing": { x: 646, y: 537 },
  "lower-road": { x: 1110, y: 555 },
} as const;

const ferryBends = points([[400, 508], [543, 591], [677, 619], [835, 627], [1020, 655]]);

function routePoints(id: ScenarioRouteId, from: NodeId, to: NodeId): Point[] {
  if (id !== "ferry-crossing") return [nodes[from], nodes[to]];
  const bends = from === "shelter" ? ferryBends : [...ferryBends].reverse();
  return [nodes[from], ...bends, nodes[to]];
}

function strokePath(graphics: Phaser.GameObjects.Graphics, path: readonly Point[], dashed: boolean) {
  for (let i = 1; i < path.length; i++) {
    const start = path[i - 1];
    const end = path[i];
    if (!dashed) {
      graphics.lineBetween(start.x, start.y, end.x, end.y);
      continue;
    }
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    for (let offset = 0; offset < length; offset += 29) {
      const a = offset / length;
      const b = Math.min(offset + 16, length) / length;
      graphics.lineBetween(
        Phaser.Math.Linear(start.x, end.x, a), Phaser.Math.Linear(start.y, end.y, a),
        Phaser.Math.Linear(start.x, end.x, b), Phaser.Math.Linear(start.y, end.y, b),
      );
    }
  }
}

function drawArrow(graphics: Phaser.GameObjects.Graphics, path: readonly Point[], color: number) {
  graphics.lineStyle(8, color);
  strokePath(graphics, path, false);
  const tip = path[path.length - 1];
  const previous = path[path.length - 2];
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  graphics.fillStyle(color).fillTriangle(
    tip.x, tip.y,
    tip.x - 24 * Math.cos(angle) + 12 * Math.sin(angle),
    tip.y - 24 * Math.sin(angle) - 12 * Math.cos(angle),
    tip.x - 24 * Math.cos(angle) - 12 * Math.sin(angle),
    tip.y - 24 * Math.sin(angle) + 12 * Math.cos(angle),
  );
}

export class MapPreview extends Phaser.Scene {
  private roads!: Phaser.GameObjects.Graphics;
  private arrows!: Phaser.GameObjects.Graphics;
  private readonly markers = new Map<NodeId, NodeMarker>();
  private readonly routeText = new Map<ScenarioRouteId, Phaser.GameObjects.Text>();
  private readonly transport = new Map<VehicleId, {
    group: Phaser.GameObjects.Container;
    badge: Phaser.GameObjects.Shape;
    zone: Phaser.GameObjects.Zone;
  }>();

  constructor(
    private readonly onDestination: (id: NodeId) => void,
    private readonly onVehicle: (id: VehicleId) => void,
    private readonly onReady: () => void,
  ) {
    super("evacuation-map");
  }

  create() {
    this.drawTerrain();
    this.roads = this.add.graphics();
    this.arrows = this.add.graphics();

    for (const [id, position] of Object.entries(routeLabels)) {
      const text = this.add.text(position.x, position.y, "", {
        fontFamily, fontSize: "29px", fontStyle: "bold",
        color: "#243b39", backgroundColor: "#fffdf6", padding: { x: 11, y: 6 },
      }).setOrigin(0.5);
      this.routeText.set(id as ScenarioRouteId, text);
    }

    for (const id of nodeIds) this.drawNode(id);
    for (const id of vehicleIds) this.drawVehicle(id);
    this.onReady();
  }

  renderState({ state, moves, selected, available, forecastMode, conflicts }: MapView) {
    this.roads.clear();
    this.arrows.clear();
    for (const route of routes) {
      const closed = state.closedRoutes.includes(route.id);
      const conflict = conflicts.includes(route.id);
      const ferry = route.vehicleKind === "ferry";
      const [from, to] = route.ends;
      const path = routePoints(route.id, from, to);
      this.roads.lineStyle(15, 0xfffbf0);
      strokePath(this.roads, path, closed || ferry);
      this.roads.lineStyle(conflict ? 10 : 6, closed || conflict ? blocked : ferry ? accent : ink);
      strokePath(this.roads, path, closed || ferry);
      if (closed) {
        const segment = Math.floor((path.length - 1) / 2);
        const start = path[segment];
        const end = path[segment + 1];
        const x = (start.x + end.x) / 2;
        const y = (start.y + end.y) / 2;
        this.roads.lineStyle(5, blocked);
        this.roads.lineBetween(x - 11, y - 11, x + 11, y + 11);
        this.roads.lineBetween(x - 11, y + 11, x + 11, y - 11);
      }
      const last = route.lastOpenTurn?.[forecastMode];
      const label = this.routeText.get(route.id);
      if (label) {
        const detail = closed ? " × Закрыт" : conflict ? " · конфликт" : " · последний ход " + last;
        label.setText(route.label + detail);
        label.setColor(closed || conflict ? "#983825" : "#243b39");
      }
    }

    for (const id of vehicleIds) {
      const to = moves[id];
      if (!to) continue;
      const from = state.vehicles[id].node;
      const route = routes.find(({ ends: [a, b] }) => (from === a && to === b) || (from === b && to === a));
      if (!route) continue;
      const path = routePoints(route.id, from, to);
      const tip = path[path.length - 1];
      const previous = path[path.length - 2];
      const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
      path[path.length - 1] = { x: tip.x - 53 * Math.cos(angle), y: tip.y - 53 * Math.sin(angle) };
      drawArrow(this.arrows, path, conflicts.includes(route.id) ? blocked : accent);
    }

    for (const [id, { marker, zone }] of this.markers) {
      const isAvailable = available.includes(id);
      marker.setFillStyle(isAvailable ? 0xd5eddf : 0xfffbf0);
      marker.setStrokeStyle(isAvailable ? 8 : 5, isAvailable ? accent : ink);
      if (isAvailable) zone.setInteractive({ useHandCursor: true });
      else zone.disableInteractive();
    }
    for (const id of districtIds) this.markers.get(id)?.queue.setText("Ждут: " + state.waiting[id]);

    for (const id of nodeIds) {
      const present = vehicleIds.filter((vehicle) => state.vehicles[vehicle].node === id);
      for (const [index, vehicle] of present.entries()) {
        const { group, badge, zone } = this.transport.get(vehicle)!;
        group.setPosition(nodes[id].x + (index - (present.length - 1) / 2) * 72, nodes[id].y - 66);
        badge.setFillStyle(vehicle === selected && !state.endReason ? accent : ink);
        zone.input!.enabled = !state.endReason;
      }
    }
  }

  private drawTerrain() {
    const terrain = this.add.graphics();
    terrain.fillStyle(paper).fillRect(0, 0, map.width, map.height);
    terrain.fillStyle(0xc7c3ad, 0.62);
    for (let x = 24; x < map.width; x += 36) {
      for (let y = 24; y < map.height; y += 36) terrain.fillCircle(x, y, 2);
    }
    terrain.fillStyle(0xb7d5d5).fillPoints([...westBank, ...[...eastBank].reverse()], true);
    terrain.lineStyle(3, 0x84b2b3).strokePoints(westBank).strokePoints(eastBank);
    terrain.lineStyle(2, 0x78a4a6, 0.65);
    for (const [index, west] of westBank.entries()) {
      if (index === 0 || index === westBank.length - 1) continue;
      const middle = (west.x + eastBank[index].x) / 2;
      terrain.lineBetween(middle - 34, west.y, middle + 24, west.y);
      terrain.lineBetween(middle + 4, west.y + 17, middle + 47, west.y + 17);
    }
    for (const [x, text] of [[266, "ВЫСОКИЙ БЕРЕГ"], [672, "РЕКА"], [1470, "НИЗИНА"]] as const) {
      this.add.text(x, 50, text, { fontFamily, fontSize: "24px", color: "#43645c" }).setOrigin(0.5);
    }
  }

  private drawNode(id: NodeId) {
    const { x, y, symbol, label } = nodes[id];
    const marker = this.add.circle(x, y, 40, 0xfffbf0).setStrokeStyle(5, ink);
    this.add.text(x, y, symbol, { fontFamily, fontSize: "38px", fontStyle: "bold", color: "#243b39" }).setOrigin(0.5);
    this.add.text(x, y + 58, label, {
      fontFamily, fontSize: "37px", fontStyle: "bold", color: "#243b39",
      backgroundColor: "#f3eee1", padding: { x: 8, y: 2 },
    }).setOrigin(0.5, 0);
    const queue = this.add.text(x, y + 107, "", { fontFamily, fontSize: "30px", color: "#355851" }).setOrigin(0.5, 0);
    const zone = this.add.zone(x, y + 20, 182, 122)
      .setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.onDestination(id));
    this.markers.set(id, { marker, queue, zone });
  }

  private drawVehicle(id: VehicleId) {
    const { label, kind } = firstScenario.vehicles[id];
    const badge = kind === "bus" ? this.add.rectangle(0, 0, 58, 43, ink) : this.add.circle(0, 0, 25, ink);
    const text = this.add.text(0, 0, label, { fontFamily, fontSize: "27px", fontStyle: "bold", color: "#ffffff" }).setOrigin(0.5);
    const zone = this.add.zone(0, 0, 66, 46).setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.onVehicle(id));
    const group = this.add.container(0, 0, [badge, text, zone]);
    this.transport.set(id, { group, badge, zone });
  }
}
