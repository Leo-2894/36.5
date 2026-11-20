const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktopOnline", { startHost: () => ipcRenderer.invoke("start-online-host") });
}
