"use strict";

const fs = require("node:fs");
const files = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");

const providerVersion = "2026.11.1";
const expectedHash = "341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35";
const binaryUrl = "https://github.com/cloudflare/cloudflared/releases/download/" + providerVersion + "/cloudflared-windows-amd64.exe";
const publicAddress = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s|]|$)/;

async function hasExpectedHash(filename) {
  try {
    const hash = createHash("sha256");
    for await (const block of fs.createReadStream(filename)) hash.update(block);
    return hash.digest("hex") === expectedHash;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function prepareBinary(cacheDir) {
  await files.mkdir(cacheDir, { recursive: true });
  const executable = path.join(cacheDir, "cloudflared-" + providerVersion + ".exe");
  if (await hasExpectedHash(executable)) return executable;
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("This tunnel build requires Windows x64");

  const temporary = executable + "." + randomUUID() + ".download";
  try {
    const response = await fetch(binaryUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error("Could not download Cloudflare Tunnel");
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: "wx" }));
    if (!await hasExpectedHash(temporary)) throw new Error("Cloudflare Tunnel checksum mismatch");
    try { await files.rename(temporary, executable); }
    catch (error) { if (!await hasExpectedHash(executable)) throw error; }
    return executable;
  } finally {
    await files.unlink(temporary).catch(() => {});
  }
}

function waitForAddress(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => finish(new Error("Cloudflare did not issue an address")), 25_000);
    const onExit = () => finish(new Error("Cloudflare Tunnel closed during startup"));
    function finish(error, url) {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", finish);
      child.stderr.off("data", collect);
      child.stdout.off("data", collect);
      if (error) reject(error);
      else resolve(url);
    }
    function collect(chunk) {
      buffer = (buffer + chunk.toString()).slice(-8192);
      const match = publicAddress.exec(buffer);
      if (match) finish(null, match[0]);
    }
    child.on("error", finish);
    child.on("exit", onExit);
    child.stderr.on("data", collect);
    child.stdout.on("data", collect);
  });
}

async function openPublicTunnel({ cacheDir, port, checkAddress, isOpen = () => true }) {
  const executable = await prepareBinary(cacheDir);
  if (!isOpen()) throw new Error("The game window closed");
  const config = path.join(cacheDir, "tunnel-" + randomUUID() + ".yml");
  await files.writeFile(config, "{}\n", { flag: "wx" });
  const child = spawn(executable, [
    "tunnel", "--no-autoupdate", "--config", config,
    "--protocol", "http2", "--metrics", "127.0.0.1:0", "--url", "http://127.0.0.1:" + port,
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", () => {});
  child.once("close", () => { files.unlink(config).catch(() => {}); });
  const close = () => { if (child.exitCode === null) child.kill(); };
  try {
    const origin = await waitForAddress(child);
    child.stdout.resume();
    child.stderr.resume();

    // The provider can announce a URL before traffic reaches the origin.
    for (let attempt = 0; attempt < 20 && child.exitCode === null && isOpen(); attempt++) {
      if (await checkAddress(origin) && child.exitCode === null && isOpen()) {
        return { origin, close, onExit: listener => child.once("exit", listener) };
      }
      await delay(600);
    }
    throw new Error("The public address did not reach the game server");
  } catch (error) {
    close();
    throw error;
  }
}

module.exports = { openPublicTunnel };
