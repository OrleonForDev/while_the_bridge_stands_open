import Phaser from "phaser";
import { firstScenario, districtIds, vehicleIds } from "./game/scenario.ts";
import type { DistrictId, NodeId, ScenarioRouteId, VehicleId } from "./game/scenario.ts";
import type { GameState, TurnEvent, TurnOrders } from "./game/turn.ts";

const { map, nodes, routes, vehicles } = firstScenario;
const nodeIds = Object.keys(nodes) as NodeId[];
const ink = 0x243c39;
const accent = 0x11675e;
const plannedColor = 0x234aa0;
const availableGlow = 0x72c4a3;
const blocked = 0x9a422e;
const paper = 0xf1f0e8;
const emptyTransport = "#536961";
const occupiedTransport = "#925119";
const fontFamily = '"Bridge Inter", "Segoe UI", sans-serif';
const transportSpacing = 104;
const movementDuration = 950;

type Point = { x: number; y: number };
type MapView = {
  state: GameState;
  moves: NonNullable<TurnOrders["moves"]>;
  selected: VehicleId;
  available: readonly NodeId[];
  conflicts: readonly ScenarioRouteId[];
  resolving: boolean;
};
type NodeMarker = {
  marker: Phaser.GameObjects.Arc;
  zone: Phaser.GameObjects.Zone;
};
type VehicleMarker = {
  group: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Image | undefined;
  occupancy: Phaser.GameObjects.Text;
  selection: Phaser.GameObjects.Graphics;
  checkmark: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
};

function points(coords: readonly [number, number][]) {
  return coords.map(([x, y]) => new Phaser.Math.Vector2(x, y));
}

const westBank = points([[550, 0], [530, 108], [552, 212], [586, 330], [565, 440], [519, 551], [518, 679], [558, map.height]]);
const eastBank = points([[810, 0], [776, 118], [801, 230], [836, 349], [816, 455], [772, 576], [784, 704], [828, map.height]]);

const routeLabels = {
  bridge: { x: 679, y: 326 },
  "ferry-crossing": { x: 640, y: 554 },
  "lower-road": { x: 1138, y: 522 },
} as const;

const ferryBends = points([[400, 508], [543, 591], [677, 619], [770, 644]]);

function routePoints(id: ScenarioRouteId, from: NodeId, to: NodeId): Point[] {
  if (id !== "ferry-crossing") return [nodes[from], nodes[to]];
  const bends = from === "shelter" ? ferryBends : [...ferryBends].reverse();
  return [nodes[from], ...bends, nodes[to]];
}

function parkedPosition(state: GameState, vehicle: VehicleId): Point {
  const node = state.vehicles[vehicle].node;
  const present = vehicleIds.filter((id) => state.vehicles[id].node === node);
  const { x, y } = nodes[node];
  if (node === "embankment") {
    // Keep the ferry at the riverbank and the buses on the road side.
    const slot = vehicle === "ferry" ? -0.5 : present.indexOf(vehicle) + 0.5;
    return { x: x + slot * transportSpacing, y: y - 71 };
  }
  const offset = (present.indexOf(vehicle) - (present.length - 1) / 2) * transportSpacing;
  return { x: x + offset, y: y - 71 };
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
  graphics.lineStyle(15, 0xf9f8f1);
  strokePath(graphics, path, false);
  graphics.lineStyle(9, color);
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
  private availability!: Phaser.GameObjects.Graphics;
  private arrows!: Phaser.GameObjects.Graphics;
  private readonly markers = new Map<NodeId, NodeMarker>();
  private readonly queues = new Map<DistrictId, Phaser.GameObjects.Text>();
  private readonly routeText = new Map<ScenarioRouteId, Phaser.GameObjects.Text>();
  private readonly transport = new Map<VehicleId, VehicleMarker>();
  private readonly reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(
    private readonly onDestination: (id: NodeId) => void,
    private readonly onVehicle: (id: VehicleId) => void,
    private readonly onReady: () => void,
  ) {
    super("evacuation-map");
  }

  preload() {
    const assets = import.meta.env.BASE_URL + "assets/";
    const icons = assets + "transport/";
    this.load.svg("vehicle-bus", icons + "bus.svg", { scale: 2 });
    this.load.svg("vehicle-ferry", icons + "ferry.svg", { scale: 2 });
    this.load.svg("waiting-people", icons + "people.svg", { scale: 2 });
    for (const id of nodeIds) this.load.svg("node-" + id, assets + "map/" + id + ".svg", { scale: 2 });
  }

  create() {
    this.drawTerrain();
    this.roads = this.add.graphics();
    this.availability = this.add.graphics();
    this.arrows = this.add.graphics();

    for (const [id, position] of Object.entries(routeLabels)) {
      const text = this.add.text(position.x, position.y, "", {
        fontFamily, fontSize: "27px", fontStyle: "bold",
        color: "#38534d", backgroundColor: "#f9f8f1", padding: { x: 13, y: 6 },
      }).setOrigin(0.5);
      this.routeText.set(id as ScenarioRouteId, text);
    }

    for (const kind of ["bus", "ferry"]) {
      const key = "vehicle-" + kind;
      this.colorSilhouette(key, key + "-empty", emptyTransport);
      this.colorSilhouette(key, key + "-occupied", occupiedTransport);
    }
    for (const id of nodeIds) this.drawNode(id);
    for (const id of districtIds) this.drawQueue(id);
    for (const id of vehicleIds) this.drawVehicle(id);
    this.onReady();
  }

  renderState({ state, moves, selected, available, conflicts, resolving }: MapView) {
    this.roads.clear();
    this.tweens.killTweensOf(this.availability);
    this.availability.clear().setAlpha(0.65);
    this.arrows.clear();
    const origin = state.vehicles[selected].node;
    const plannedStops = new Set<NodeId>();
    for (const destination of Object.values(moves)) {
      if (destination) plannedStops.add(destination);
    }
    const selectedDestination = moves[selected];
    for (const route of routes) {
      const closed = state.closedRoutes.includes(route.id);
      const conflict = conflicts.includes(route.id);
      const ferry = route.vehicleKind === "ferry";
      const [from, to] = route.ends;
      const path = routePoints(route.id, from, to);
      const isAvailable = !resolving &&
        ((from === origin && available.includes(to)) || (to === origin && available.includes(from)));
      const isSelectedOrder = (from === origin && to === selectedDestination) ||
        (to === origin && from === selectedDestination);
      this.roads.lineStyle(route.id === "bridge" ? 20 : 14, 0xf9f8f1);
      strokePath(this.roads, path, closed || ferry);
      const lineColor = closed || conflict ? blocked : isAvailable ? accent : ferry ? 0x4c7178 : 0x74827b;
      this.roads.lineStyle(conflict || isAvailable ? 8 : 5, lineColor);
      strokePath(this.roads, path, closed || ferry);
      if (isAvailable && !isSelectedOrder && !closed && !conflict) {
        this.availability.lineStyle(22, availableGlow, 0.6);
        strokePath(this.availability, path, ferry);
      }
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
      const label = this.routeText.get(route.id);
      if (label) {
        const detail = closed ? " ×" : conflict ? " !" : "";
        label.setText(route.label + detail);
        label.setColor(closed || conflict ? "#9a422e" : "#38534d");
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
      drawArrow(this.arrows, path, conflicts.includes(route.id) ? blocked : plannedColor);
    }

    for (const [id, { marker, zone }] of this.markers) {
      const isAvailable = !resolving && available.includes(id);
      const current = !resolving && !state.endReason && id === origin;
      const planned = plannedStops.has(id);
      marker.setFillStyle(planned ? 0xe5edff : isAvailable || current ? 0xe3f1e8 : 0xf9f8f1);
      marker.setStrokeStyle(planned || isAvailable ? 7 : 3, planned ? plannedColor : isAvailable || current ? accent : 0x677a71);
      if (isAvailable && id !== selectedDestination) {
        this.availability.lineStyle(9, availableGlow);
        this.availability.strokeCircle(marker.x, marker.y, 49);
      }
      if (isAvailable) zone.setInteractive({ useHandCursor: true });
      else zone.disableInteractive();
    }
    if (!resolving && available.some((id) => id !== selectedDestination) && !this.reduceMotion.matches) {
      this.tweens.add({
        targets: this.availability,
        alpha: { from: 0.35, to: 0.95 },
        duration: 1050,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: 2,
      });
    }
    this.updateQueues(state.waiting);

    for (const vehicle of vehicleIds) {
      const { group, selection, checkmark, zone } = this.transport.get(vehicle)!;
      const { x, y } = parkedPosition(state, vehicle);
      group.setPosition(x, y);
      const active = vehicle === selected && !state.endReason;
      group.setDepth(active ? 1 : 0);
      this.updateOccupancy(vehicle, state.vehicles[vehicle].passengers?.count ?? 0);
      selection.setVisible(active);
      checkmark.setVisible(moves[vehicle] !== undefined);
      zone.input!.enabled = !resolving && !state.endReason;
    }
  }

  animateMoves(events: readonly TurnEvent[], nextState: GameState) {
    this.updateQueues(nextState.waiting);
    for (const event of events) {
      if (event.kind === "boarded") this.updateOccupancy(event.vehicle, event.passengers.count);
    }

    const movements = events.filter((event) => event.kind === "moved");
    const trips = movements.map(({ vehicle, route, from, to }) => {
      const { group, checkmark } = this.transport.get(vehicle)!;
      const path = new Phaser.Curves.Path(group.x, group.y);
      const waypoints = routePoints(route, from, to);
      // At the embankment, enter and leave the route directly from the vehicle's stop.
      if (from === "embankment") waypoints.shift();
      if (to === "embankment") waypoints.pop();
      const destination = parkedPosition(nextState, vehicle);
      for (const { x, y } of [...waypoints, destination]) path.lineTo(x, y);
      group.setDepth(2);
      checkmark.setVisible(false);
      return { group, path, point: new Phaser.Math.Vector2() };
    });

    return new Promise<void>((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: movementDuration,
        ease: "Sine.easeInOut",
        onUpdate: (tween) => {
          const progress = tween.getValue()!;
          for (const { group, path, point } of trips) {
            path.getPoint(progress, point);
            group.setPosition(point.x, point.y);
          }
        },
        onComplete: () => resolve(),
      });
    });
  }

  private drawTerrain() {
    const terrain = this.add.graphics();
    terrain.fillStyle(paper).fillRect(0, 0, map.width, map.height);
    terrain.fillStyle(0xdce7df).fillPoints([...westBank, ...points([[0, map.height], [0, 0]])], true);
    terrain.fillStyle(0xc0dce1).fillPoints([...westBank, ...[...eastBank].reverse()], true);
    terrain.lineStyle(3, 0x9ebec2).strokePoints(westBank).strokePoints(eastBank);
    terrain.lineStyle(2, 0x7ea9af, 0.65);
    for (const [index, west] of westBank.entries()) {
      if (index === 0 || index === westBank.length - 1) continue;
      const middle = (west.x + eastBank[index].x) / 2;
      terrain.lineBetween(middle - 34, west.y, middle + 24, west.y);
      terrain.lineBetween(middle + 4, west.y + 17, middle + 47, west.y + 17);
    }
    for (const [x, text] of [[266, "ВЫСОКИЙ БЕРЕГ"], [672, "РЕКА"], [1470, "НИЗИНА"]] as const) {
      this.add.text(x, 50, text, { fontFamily, fontSize: "24px", color: "#4a6864" }).setOrigin(0.5);
    }
  }

  private drawNode(id: NodeId) {
    const { x, y, label } = nodes[id];
    const marker = this.add.circle(x, y, 40, 0xf9f8f1).setStrokeStyle(3, ink);
    const key = "node-" + id;
    if (this.textures.exists(key)) this.add.image(x, y, key).setScale(0.5);
    this.add.text(x, y + 58, label, {
      fontFamily, fontSize: "36px", fontStyle: "bold", color: "#243c39",
      stroke: id === firstScenario.shelter ? "#dce7df" : "#f1f0e8", strokeThickness: 5,
    }).setOrigin(0.5, 0);
    const zone = this.add.zone(x, y + 20, 182, 122)
      .setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.onDestination(id));
    this.markers.set(id, { marker, zone });
  }

  private drawQueue(id: DistrictId) {
    const { x, y } = nodes[id];
    if (this.textures.exists("waiting-people")) {
      this.add.image(x - 4, y + 123, "waiting-people").setOrigin(1, 0.5).setScale(0.5);
    }
    const count = this.add.text(x + 4, y + 123, "", {
      fontFamily, fontSize: "34px", fontStyle: "bold", color: "#243b39",
      stroke: "#f1f0e8", strokeThickness: 3,
    }).setOrigin(0, 0.5);
    this.queues.set(id, count);
  }

  private updateQueues(waiting: GameState["waiting"]) {
    for (const [id, count] of this.queues) count.setText(String(waiting[id]));
  }

  private updateOccupancy(id: VehicleId, passengers: number) {
    const { fill, occupancy } = this.transport.get(id)!;
    const { seats } = vehicles[id];
    occupancy.setText(passengers + "/" + seats);
    if (fill) {
      const height = Math.round(fill.height * passengers / seats);
      fill.setVisible(height > 0).setCrop(0, fill.height - height, fill.width, height);
    }
  }

  private colorSilhouette(sourceKey: string, key: string, color: string) {
    if (!this.textures.exists(sourceKey) || this.textures.exists(key)) return;
    const source = this.textures.get(sourceKey).getSourceImage();
    if (!(source instanceof HTMLImageElement)) return;
    const texture = this.textures.createCanvas(key, source.naturalWidth, source.naturalHeight);
    if (!texture) return;

    // Use the SVG's alpha channel so the same fill works in WebGL and Canvas.
    const context = texture.getContext();
    context.fillStyle = color;
    context.fillRect(0, 0, texture.width, texture.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(source, 0, 0);
    context.globalCompositeOperation = "source-over";
    texture.refresh();
  }

  private drawVehicle(id: VehicleId) {
    const { label, kind } = vehicles[id];
    const key = "vehicle-" + kind;
    const iconX = kind === "bus" ? -15 : 0;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const icon = this.textures.exists(key + "-empty")
      ? this.add.image(iconX, 0, key + "-empty").setScale(0.5)
      : undefined;
    const fill = icon && this.textures.exists(key + "-occupied")
      ? this.add.image(iconX, 0, key + "-occupied").setScale(0.5)
      : undefined;
    if (icon && fill) parts.push(icon, fill);
    if (kind === "bus" || !icon) {
      const text = this.add.text(icon ? 33 : 0, 1, label, {
        fontFamily, fontSize: "22px", fontStyle: "bold", color: "#243b39",
      }).setOrigin(0.5);
      parts.push(text);
    }
    const occupancy = this.add.text(iconX, -34, "", {
      fontFamily, fontSize: "28px", fontStyle: "bold", color: "#243b39",
      stroke: "#f1f0e8", strokeThickness: 4,
    }).setOrigin(0.5);
    const selection = this.add.graphics();
    selection.fillStyle(0xf2fcf5).fillRoundedRect(-48, -51, 96, 79, 13);
    selection.lineStyle(5, accent).strokeRoundedRect(-48, -51, 96, 79, 13);
    selection.setVisible(false);
    const zone = this.add.zone(0, -10, kind === "bus" ? 100 : 72, 72).setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.onVehicle(id));
    const checkmark = this.add.text(kind === "bus" ? 40 : 32, -20, "✓", {
      fontFamily, fontSize: "22px", fontStyle: "bold", color: "#206341",
      stroke: "#f1f0e8", strokeThickness: 3,
    }).setOrigin(0.5).setVisible(false);
    const group = this.add.container(0, 0, [selection, ...parts, occupancy, checkmark, zone]);
    this.transport.set(id, { group, fill, occupancy, selection, checkmark, zone });
  }
}
