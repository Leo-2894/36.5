"use strict";

const fs = require("node:fs");
const files = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const https = require("node:https");
const { isIP } = require("node:net");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");

const providerVersion = "2026.11.1";
const expectedHash = "341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35";
const binaryUrl = "https://github.com/cloudflare/cloudflared/releases/download/" + providerVersion + "/cloudflared-windows-amd64.exe";
const binaryPreparations = new Map();
const publicAddress = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s|]|$)/;

async function resolvePublicAddress(hostname) {
  const dns = new URL("https://cloudflare-dns.com/dns-query");
  dns.searchParams.set("name", hostname);
  dns.searchParams.set("type", "A");
  const response = await fetch(dns, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) return null;
  const { Answer } = await response.json();
  return Answer?.find(record => record.type === 1 && isIP(record.data) === 4)?.data ?? null;
}

async function checkPublicOrigin(origin) {
  try {
    const url = new URL("/api/info", origin);
    // The OS can cache a negative reply if the URL was announced just before DNS propagation.
    const address = await resolvePublicAddress(url.hostname);
    if (!address) return false;
    return await new Promise((resolve, reject) => {
      const request = https.get(url, {
        family: 4,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address, family: 4 }]);
          else callback(null, address, 4);
        },
        signal: AbortSignal.timeout(4000),
      }, async response => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(false);
          return;
        }
        try {
          let body = "";
          for await (const chunk of response) {
            body += chunk;
            if (body.length > 4096) throw new Error("Unexpected tunnel response");
          }
          resolve(JSON.parse(body).origin === origin);
        } catch (error) { reject(error); }
      });
      request.on("error", reject);
    });
  } catch { return false; }
}

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

function preparePublicTunnel(cacheDir) {
  if (!binaryPreparations.has(cacheDir)) {
    const preparation = prepareBinary(cacheDir).finally(() => binaryPreparations.delete(cacheDir));
    binaryPreparations.set(cacheDir, preparation);
  }
  return binaryPreparations.get(cacheDir);
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

async function startTunnel({ executable, cacheDir, port, checkAddress, isOpen }) {
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
    const deadline = performance.now() + 45_000;
    while (performance.now() < deadline && child.exitCode === null && isOpen()) {
      if (await checkAddress(origin) && child.exitCode === null && isOpen()) {
        return { origin, close, onExit: listener => child.once("exit", listener) };
      }
      await delay(900);
    }
    throw new Error("The public address did not reach the game server");
  } catch (error) {
    close();
    throw error;
  }
}

async function openPublicTunnel({ cacheDir, port, checkAddress, isOpen = () => true }) {
  const executable = await preparePublicTunnel(cacheDir);
  const options = { executable, cacheDir, port, checkAddress, isOpen };
  try {
    return await startTunnel(options);
  } catch (error) {
    if (!isOpen()) throw error;
    return startTunnel(options);
  }
}

module.exports = { openPublicTunnel, preparePublicTunnel, checkPublicOrigin, resolvePublicAddress };
