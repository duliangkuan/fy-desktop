const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fy", {
  launch: (tool) => ipcRenderer.invoke("launch", tool),
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  winCtl: (action) => ipcRenderer.invoke("win-ctl", action),
  msgbox: (message) => ipcRenderer.invoke("msgbox", message),
  binStatus: () => ipcRenderer.invoke("bin-status"),
  version: () => ipcRenderer.invoke("app-version"),
  onProgress: (cb) => ipcRenderer.on("cli-progress", (_e, payload) => cb(payload)),
  // 网络自检（走 relay，与 CC 同路径）
  netCheck: () => ipcRenderer.invoke("net-check"),
  // 在系统默认浏览器打开外链
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  // Memory 可视化
  memoryRead: () => ipcRenderer.invoke("memory-read"),
  memoryWrite: (content) => ipcRenderer.invoke("memory-write", content),
  memoryWatch: () => ipcRenderer.invoke("memory-watch"),
  onMemoryChanged: (cb) => ipcRenderer.on("memory-changed", () => cb()),
});
