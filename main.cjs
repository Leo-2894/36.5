const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createGameServer, defaultPort } = require("./server.cjs");
const { openPublicTunnel, checkPublicOrigin } = require("./tunnel.cjs");

const gamePage = path.join(__dirname, "index.html");
const hosts = new Map();

function stopHost(session) {
  session.open = false;
  session.tunnel?.close();
  session.server.closeAllConnections();
  session.server.close();
}

async function hostGame(session, mode) {
  const internet = mode === "internet";
  const { server } = session;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(internet ? 0 : defaultPort, internet ? "127.0.0.1" : "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = server.address().port;
  if (internet) {
    session.tunnel = await openPublicTunnel({
      cacheDir: path.join(app.getPath("userData"), "invite-bridge"),
      port,
      isOpen: () => session.open,
      checkAddress(origin) {
        session.origin = origin;
        return checkPublicOrigin(origin);
      },
    });
    session.tunnel.onExit(() => {
      if (!session.open) return;
      stopHost(session);
      hosts.delete(mode);
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().startsWith("http://127.0.0.1:" + port + "/")) {
          win.loadFile(gamePage, { query: { online: "tunnel-closed" } });
        }
      }
    });
  }
  return "http://127.0.0.1:" + port;
}

ipcMain.handle("start-online-host", (event, mode) => {
  const source = new URL(event.senderFrame.url);
  source.search = "";
  source.hash = "";
  if (source.href !== pathToFileURL(gamePage).href) throw new Error("Invalid host request");
  if (!["lan", "internet"].includes(mode)) throw new Error("Invalid host mode");
  if (!hosts.has(mode)) {
    const session = { open: true, origin: null };
    session.server = createGameServer({ inviteOrigin: () => session.origin });
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
