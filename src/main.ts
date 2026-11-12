import Phaser from "phaser";
import { MAP_WIDTH, MAP_HEIGHT, MapPreview, mapNodes } from "./map-preview";
import type { MapNodeId } from "./map-preview";
import "./style.css";

const map = document.querySelector<HTMLDivElement>("#map")!;
const status = document.querySelector<HTMLParagraphElement>("#selection-status")!;
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-node]"));

function selectNode(id: MapNodeId) {
  const node = mapNodes.find((candidate) => candidate.id === id)!;
  scene.select(node);
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.node === id));
  }
  status.textContent = `Выбран узел: ${node.label}`;
}

const scene = new MapPreview(selectNode, () => {
  status.textContent = "Узел не выбран";
  for (const button of buttons) {
    button.disabled = false;
  }
});

for (const node of mapNodes) {
  const button = buttons.find((candidate) => candidate.dataset.node === node.id)!;
  button.addEventListener("click", () => selectNode(node.id));
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: map,
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
  backgroundColor: "#f3eee1",
  scene,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  banner: false,
  audio: { noAudio: true },
});
