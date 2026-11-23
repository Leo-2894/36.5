const { app, BrowserWindow, ipcMain, nativeImage, protocol } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createGameServer, defaultPort } = require("./server.cjs");
const { isCardArtwork, readCustomCardArt } = require("./card-art.cjs");
const { openPublicTunnel, preparePublicTunnel, checkPublicOrigin } = require("./tunnel.cjs");

const gamePage = path.join(__dirname, "index.html");
const hosts = new Map();
const cardArtDirectory = path.join(path.dirname(app.getPath("exe")), "card-art");
const customCardArt = file => readCustomCardArt(cardArtDirectory, file, bytes => !nativeImage.createFromBuffer(bytes).isEmpty());

async function serveDesktopCardArt(request) {
  const url = new URL(request.url);
  const file = url.pathname.slice(1);
  if (request.method !== "GET" || url.host !== "local" || !isCardArtwork(file)) {
    return new Response(null, { status: 404 });
  }
  const bytes = await customCardArt(file) ?? await fs.readFile(path.join(__dirname, "assets", "cards", file));
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}

function stopHost(session) {
  session.open = false;
  session.tunnel?.close();
  session.server.closeAllConnections();
  session.server.close();
}

const inviteCache = () => path.join(app.getPath("userData"), "invite-bridge");

async function publishInternetInvite(session, port) {
  try {
    const tunnel = await openPublicTunnel({
      cacheDir: inviteCache(),
      port,
      isOpen: () => session.open,
      checkAddress(origin) {
        session.origin = origin;
        return checkPublicOrigin(origin);
      },
    });
    if (!session.open) {
      tunnel.close();
      return;
    }
    session.tunnel = tunnel;
    session.inviteState = "ready";
    tunnel.onExit(() => {
      if (!session.open) return;
      stopHost(session);
      hosts.delete("internet");
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().startsWith("http://127.0.0.1:" + port + "/")) {
          win.loadFile(gamePage, { query: { online: "tunnel-closed" } });
        }
      }
    });
  } catch {
    session.origin = null;
    if (session.open) session.inviteState = "failed";
  }
}

async function hostGame(session, mode) {
  const internet = mode === "internet";
  const { server } = session;
  const address = internet ? "127.0.0.1" : "0.0.0.0";
  const listen = port => new Promise((resolve, reject) => {
    const onError = error => {
      server.off("listening", onListen);
      reject(error);
    };
    const onListen = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListen);
    server.listen(port, address);
  });
  try {
    await listen(internet ? 0 : defaultPort);
  } catch (error) {
    if (internet || error.code !== "EADDRINUSE") throw error;
    await listen(0);
  }
  const port = server.address().port;
  if (internet) void publishInternetInvite(session, port);
  return "http://127.0.0.1:" + port;
}

function requireDesktopGame(event) {
  const source = new URL(event.senderFrame.url);
  source.search = "";
  source.hash = "";
  if (source.href !== pathToFileURL(gamePage).href) throw new Error("Invalid host request");
}

ipcMain.handle("prepare-internet-host", async event => {
  requireDesktopGame(event);
  if (!hosts.has("internet")) await preparePublicTunnel(inviteCache());
});

ipcMain.handle("start-online-host", (event, mode) => {
  requireDesktopGame(event);
  if (!["lan", "internet"].includes(mode)) throw new Error("Invalid host mode");
  const previous = hosts.get(mode);
  if (previous?.inviteState === "failed") {
    stopHost(previous);
    hosts.delete(mode);
  }
  if (!hosts.has(mode)) {
    const session = { open: true, origin: null, inviteState: mode === "internet" ? "preparing" : null };
    session.server = createGameServer({
      inviteOrigin: () => session.origin, inviteState: () => session.inviteState, customCardArt, mode,
    });
    session.ready = hostGame(session, mode).catch(error => {
      stopHost(session);
      hosts.delete(mode);
      throw error;
    });
    hosts.set(mode, session);
  }
  return hosts.get(mode).ready;
});

app.on("will-quit", () => {
  for (const session of hosts.values()) stopHost(session);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1000,
    minHeight: 650,
    autoHideMenuBar: true,
    backgroundColor: "#070a0f",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  win.loadFile(gamePage);
}

app.whenReady().then(() => {
  protocol.handle("card-art", serveDesktopCardArt);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
