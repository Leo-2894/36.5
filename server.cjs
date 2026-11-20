"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream");
const { Rooms, RoomError } = require("./rooms.cjs");

const publicFiles = new Set(["index.html", "game.css", "online.css", "rules.js", "messages.js", "ui.js", "online.js"]);
const mediaTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};
const assetPath = /^assets\/(?:[a-z0-9-]+\/)?[a-z0-9.-]+\.(?:png|mp3|m4a)$/;
const roomRoute = /^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|action|leave))?$/;
const defaultPort = 3650;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new RoomError(415, "INVALID_REQUEST");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new RoomError(413, "INVALID_REQUEST");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RoomError(400, "INVALID_REQUEST");
  }
}

function localAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, interfaces]) => interfaces
    .filter(info => info.family === "IPv4" && !info.internal && !info.address.startsWith("169.254."))
    .map(info => ({ name, address: info.address })))
    .sort((a, b) => Number(/virtual|vethernet|vmware|docker/i.test(a.name)) - Number(/virtual|vethernet|vmware|docker/i.test(b.name)))
    .map(info => info.address);
}

function serveFile(request, response, pathname) {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!publicFiles.has(file) && !assetPath.test(file)) {
    json(response, 404, { error: "NOT_FOUND" });
    return;
  }
  const absolute = path.join(__dirname, file);
  fs.stat(absolute, (error, info) => {
    if (error || !info.isFile()) {
      json(response, 404, { error: "NOT_FOUND" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": mediaTypes[path.extname(file)],
      "Content-Length": info.size,
      "Cache-Control": file.startsWith("assets/") ? "public, max-age=3600" : "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else pipeline(fs.createReadStream(absolute), response, () => {});
  });
}

function createGameServer({ rooms = new Rooms(), inviteOrigin = process.env.INVITE_ORIGIN } = {}) {
  const publishedOrigin = typeof inviteOrigin === "function" ? inviteOrigin : () => inviteOrigin ? new URL(inviteOrigin).origin : null;
  const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 8_000 }, async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const target = new URL(request.url, "http://localhost");
      const method = request.method;
      if (target.pathname === "/api/info" && method === "GET") {
        const socketAddress = request.socket.remoteAddress;
        const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socketAddress) &&
          /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? "");
        const port = server.address().port;
        const addresses = local ? localAddresses().map(address => "http://" + address + ":" + port) : [];
        json(response, 200, { origin: publishedOrigin(), addresses });
        return;
      }
      if (target.pathname === "/api/rooms" && method === "POST") {
        await readJson(request);
        json(response, 201, rooms.create());
        return;
      }

      const route = roomRoute.exec(target.pathname);
      if (route) {
        const [, code, operation] = route;
        const token = request.headers.authorization?.match(/^Bearer ([\w-]{32})$/)?.[1];
        if (operation === "join" && method === "POST") {
          await readJson(request);
          json(response, 200, rooms.join(code));
          return;
        }
        if (!operation && method === "GET") {
          const after = Number(target.searchParams.get("after"));
          const state = rooms.read(code, token, after);
          if (state) json(response, 200, state);
          else response.writeHead(204, { "Cache-Control": "no-store" }).end();
          return;
        }
        if (operation === "action" && method === "POST") {
          const command = await readJson(request);
          json(response, 200, rooms.action(code, token, command));
          return;
        }
        if (operation === "leave" && method === "POST") {
          await readJson(request);
          rooms.leave(code, token);
          response.writeHead(204).end();
          return;
        }
        throw new RoomError(405, "INVALID_REQUEST");
      }
      if (method === "GET" || method === "HEAD") serveFile(request, response, target.pathname);
      else throw new RoomError(405, "INVALID_REQUEST");
    } catch (error) {
      if (!(error instanceof RoomError)) console.error(error);
      if (!response.headersSent && !response.destroyed) {
        json(response, error.status ?? 500, { error: error.code && error instanceof RoomError ? error.code : "SERVER_ERROR" });
      }
    }
  });
  const sweep = setInterval(() => rooms.sweep(), 30_000);
  sweep.unref();
  server.on("close", () => {
    clearInterval(sweep);
    rooms.close();
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? defaultPort);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createGameServer();
  server.on("error", error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const boundPort = server.address().port;
    console.log("36.5 · http://localhost:" + boundPort);
    for (const address of localAddresses()) console.log("LAN  · http://" + address + ":" + boundPort);
  });
}

module.exports = { createGameServer, defaultPort };

