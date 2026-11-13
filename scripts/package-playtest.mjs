import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid package version.");

const release = join(root, "release");
const zip = join(release, "while-the-bridge-stands-open-" + version + "-windows.zip");
const tempRoot = resolve(tmpdir());
const staging = resolve(await mkdtemp(join(tempRoot, "bridge-playtest-")));
if (dirname(staging) !== tempRoot || !basename(staging).startsWith("bridge-playtest-")) {
  throw new Error("Invalid playtest staging directory.");
}

try {
  await mkdir(release, { recursive: true });
  await cp(join(root, "dist"), join(staging, "game"), { recursive: true });
  await cp(join(root, "handoff"), staging, { recursive: true });
  await copyFile(join(root, "node_modules", "phaser", "LICENSE.md"), join(staging, "game", "assets", "PHASER-LICENSE.md"));

  const tar = spawnSync("tar.exe", ["-a", "-c", "-f", zip, "-C", staging, "."], { stdio: "inherit" });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error("Could not create the playtest ZIP.");
  console.log("ZIP: " + zip);
} finally {
  await rm(staging, { recursive: true, force: true });
}
