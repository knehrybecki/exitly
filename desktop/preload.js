const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vpnHub", {
  getRoot: () => ipcRenderer.invoke("hub:getRoot"),
  getAppInfo: () => ipcRenderer.invoke("hub:getAppInfo"),
  getSnapshot: () => ipcRenderer.invoke("hub:getSnapshot"),
  setupEnv: (privateKey) => ipcRenderer.invoke("hub:setupEnv", privateKey),
  connect: (country) => ipcRenderer.invoke("hub:connect", country),
  disconnect: () => ipcRenderer.invoke("hub:disconnect"),
  refreshIp: () => ipcRenderer.invoke("hub:refreshIp"),
  parallelUp: (codes) => ipcRenderer.invoke("hub:parallelUp", codes),
  parallelDown: (codes) => ipcRenderer.invoke("hub:parallelDown", codes),
  copy: (text) => ipcRenderer.invoke("hub:copy", text),
  openExternal: (url) => ipcRenderer.invoke("hub:openExternal", url),
  revealRoot: () => ipcRenderer.invoke("hub:revealRoot"),
  pickEnvHelp: () => ipcRenderer.invoke("hub:pickEnvHelp"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onLog: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("hub:log", handler);
    return () => ipcRenderer.removeListener("hub:log", handler);
  },
  onUpdateStatus: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
});
