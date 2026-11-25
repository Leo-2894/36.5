const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktopOnline", {
    startHost: mode => ipcRenderer.invoke("start-online-host", mode),
    prepareInternet: () => ipcRenderer.invoke("prepare-internet-host"),
  });
}
