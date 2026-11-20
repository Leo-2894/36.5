const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createGameServer, defaultPort } = require("./server.cjs");

const gamePage = path.join(__dirname, "index.html");
let serverPromise;

ipcMain.handle("start-online-host", event => {
  if (event.senderFrame?.url !== pathToFileURL(gamePage).href) throw new Error("Invalid host request");
  if (!serverPromise) {
    serverPromise = new Promise((resolve, reject) => {
      const server = createGameServer();
      server.once("error", error => {
        serverPromise = null;
        reject(error);
      });
      server.listen(defaultPort, "0.0.0.0", () => resolve("http://127.0.0.1:" + server.address().port));
    });
  }
  return serverPromise;
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
