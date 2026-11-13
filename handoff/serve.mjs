import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error("Node.js 22.12 or newer is required. See START-HERE.txt.");
  process.exit(1);
}

const host = "127.0.0.1";
const gameDirectory = new URL("./game/", import.meta.url);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
  [".ogg", "audio/ogg"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/plain; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const path = request.url?.split("?")[0];
  if (path === "/" || path === "/game") {
    response.writeHead(302, { Location: "/game/" }).end();
    return;
  }

  // The archive uses ASCII filenames in game/. Serve only regular asset names.
  const file = path === "/game/" ? "index.html" : path?.slice("/game/".length);
  const type = types.get(extname(file ?? ""));
  if (!path?.startsWith("/game/") || !file || !type ||
      !file.split("/").every((segment) => /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(segment))) {
    response.writeHead(404).end();
    return;
  }

  try {
    const content = await readFile(new URL(file, gameDirectory));
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
  }
});

server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

try {
  await readFile(new URL("index.html", gameDirectory));
  server.listen(0, host, () => {
    console.log("Open in Chrome or Edge: http://" + host + ":" + server.address().port + "/game/");
    console.log("Press Ctrl+C or close this window to stop.");
  });
} catch {
  console.error("Missing game/index.html. Extract the entire ZIP and run start.cmd again.");
  process.exitCode = 1;
}
