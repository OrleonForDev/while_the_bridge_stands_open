import Phaser from "phaser";

export const MAP_WIDTH = 920;
export const MAP_HEIGHT = 460;

export const mapNodes = [
  { id: "shelter", label: "Убежище", symbol: "У", x: 225, y: 218 },
  { id: "junction", label: "Развязка", symbol: "Р", x: 695, y: 218 },
] as const;

type MapNode = (typeof mapNodes)[number];
export type MapNodeId = MapNode["id"];

const ink = 0x243b39;
const accent = 0x13736c;
const paper = 0xf3eee1;
const water = 0xb7d5d5;
const fontFamily = '"Inter", "Segoe UI", sans-serif';

const westBank = [
  [391, 0], [368, 64], [382, 127],
  [402, 189], [387, 254], [360, 318],
  [363, 384], [391, MAP_HEIGHT],
].map(([x, y]) => new Phaser.Math.Vector2(x, y));
const eastBank = [
  [528, 0], [499, 71], [513, 136],
  [539, 199], [522, 263], [491, 326],
  [490, 393], [513, MAP_HEIGHT],
].map(([x, y]) => new Phaser.Math.Vector2(x, y));

export class MapPreview extends Phaser.Scene {
  private selection!: Phaser.GameObjects.Graphics;
  private readonly markers = new Map<MapNodeId, Phaser.GameObjects.Arc>();

  constructor(
    private readonly onSelect: (id: MapNodeId) => void,
    private readonly onReady: () => void,
  ) {
    super("map-preview");
  }

  create() {
    this.drawTerrain();
    this.drawBridge();
    this.selection = this.add.graphics();

    for (const node of mapNodes) {
      this.drawNode(node);
    }

    this.onReady();
  }

  select(node: MapNode) {
    this.selection.clear().lineStyle(3, accent).strokeCircle(node.x, node.y, 34);
    for (const [id, marker] of this.markers) {
      marker.setStrokeStyle(3, id === node.id ? accent : ink);
    }
  }

  private drawTerrain() {
    const terrain = this.add.graphics();
    terrain.fillStyle(paper).fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    terrain.fillStyle(0xc7c3ad, 0.62);
    for (let x = 18; x < MAP_WIDTH; x += 24) {
      for (let y = 18; y < MAP_HEIGHT; y += 24) {
        terrain.fillCircle(x, y, 1);
      }
    }

    terrain.fillStyle(water).fillPoints([...westBank, ...[...eastBank].reverse()], true);
    terrain.lineStyle(2, 0x84b2b3).strokePoints(westBank).strokePoints(eastBank);

    terrain.lineStyle(1.5, 0x78a4a6, 0.65);
    for (const [index, west] of westBank.entries()) {
      if (index === 0 || index === westBank.length - 1) continue;
      const east = eastBank[index];
      const middle = (west.x + east.x) / 2;
      terrain.lineBetween(middle - 22, west.y, middle + 12, west.y);
      terrain.lineBetween(middle + 1, west.y + 11, middle + 26, west.y + 11);
    }
  }

  private drawBridge() {
    const [shelter, junction] = mapNodes;
    const y = shelter.y;
    const bridge = this.add.graphics();
    bridge.lineStyle(9, 0xfffbf0).lineBetween(shelter.x, y, junction.x, y);
    bridge.lineStyle(3, ink).lineBetween(shelter.x, y, junction.x, y);
    bridge.lineStyle(2, ink).lineBetween(392, y - 7, 539, y - 7);
    bridge.lineBetween(392, y + 7, 539, y + 7);
    this.add.text(464, y - 24, "Мост", {
      fontFamily,
      fontSize: "18px",
      fontStyle: "bold",
      color: "#243b39",
    }).setOrigin(0.5, 1);
  }

  private drawNode(node: MapNode) {
    const { x, y } = node;
    const marker = this.add.circle(x, y, 26, 0xfffbf0).setStrokeStyle(3, ink);
    this.markers.set(node.id, marker);

    this.add.text(x, y, node.symbol, {
      fontFamily,
      fontSize: "23px",
      fontStyle: "bold",
      color: "#243b39",
    }).setOrigin(0.5);

    this.add.text(x, y + 48, node.label, {
      fontFamily,
      fontSize: "24px",
      fontStyle: "bold",
      color: "#243b39",
    }).setOrigin(0.5);

    this.add.zone(x, y + 12, 174, 118)
      .setInteractive({ useHandCursor: true })
      .on("pointerup", () => this.onSelect(node.id));
  }
}
