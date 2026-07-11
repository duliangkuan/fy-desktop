const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fy", {
  launch: (tool) => ipcRenderer.invoke("launch", tool),
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  winCtl: (action) => ipcRenderer.invoke("win-ctl", action),
  ping: (baseUrl) => ipcRenderer.invoke("ping", baseUrl),
  api: (path, opts) => ipcRenderer.invoke("api", path, opts),
  msgbox: (message) => ipcRenderer.invoke("msgbox", message),
  binStatus: () => ipcRenderer.invoke("bin-status"),
  version: () => ipcRenderer.invoke("app-version"),
  onProgress: (cb) => ipcRenderer.on("cli-progress", (_e, payload) => cb(payload)),
});
