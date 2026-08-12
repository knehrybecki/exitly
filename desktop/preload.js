const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vpnHub", {
  getAppInfo: () => ipcRenderer.invoke("hub:getAppInfo"),
  getSnapshot: () => ipcRenderer.invoke("hub:getSnapshot"),
  getOllama: () => ipcRenderer.invoke("hub:getOllama"),
  setOllama: (input) => ipcRenderer.invoke("hub:setOllama", input),
  checkOllama: (baseUrl) => ipcRenderer.invoke("hub:checkOllama", baseUrl),
  getSerper: () => ipcRenderer.invoke("hub:getSerper"),
  setSerper: (input) => ipcRenderer.invoke("hub:setSerper", input),
  checkSerper: (apiKey) => ipcRenderer.invoke("hub:checkSerper", apiKey),
  getHostWg: () => ipcRenderer.invoke("hub:getHostWg"),
  setHostWg: (input) => ipcRenderer.invoke("hub:setHostWg", input),
  testHostWg: () => ipcRenderer.invoke("hub:testHostWg"),
  testProjectMcp: (id) => ipcRenderer.invoke("hub:testProjectMcp", id),
  setProjectUseHostWg: (id, enabled) =>
    ipcRenderer.invoke("hub:setProjectUseHostWg", id, enabled),
  setProjectCliShell: (id, payload) =>
    ipcRenderer.invoke("hub:setProjectCliShell", id, payload),
  setupEnv: (privateKey) => ipcRenderer.invoke("hub:setupEnv", privateKey),
  connect: (country) => ipcRenderer.invoke("hub:connect", country),
  disconnect: () => ipcRenderer.invoke("hub:disconnect"),
  refreshIp: () => ipcRenderer.invoke("hub:refreshIp"),
  checkProjectIp: (id) => ipcRenderer.invoke("hub:checkProjectIp", id),
  createProject: (input) => ipcRenderer.invoke("hub:createProject", input),
  registerProject: (input) => ipcRenderer.invoke("hub:registerProject", input),
  duplicateProject: (input) =>
    ipcRenderer.invoke("hub:duplicateProject", input),
  exportProject: (id) => ipcRenderer.invoke("hub:exportProject", id),
  importProject: () => ipcRenderer.invoke("hub:importProject"),
  setCrawlerExit: (id, exit) => ipcRenderer.invoke("hub:setCrawlerExit", id, exit),
  setProjectModels: (id, models) =>
    ipcRenderer.invoke("hub:setProjectModels", id, models),
  getProjectEnv: (id) => ipcRenderer.invoke("hub:getProjectEnv", id),
  setProjectEnv: (id, values) => ipcRenderer.invoke("hub:setProjectEnv", id, values),
  openInCursor: (idOrPath) => ipcRenderer.invoke("hub:openInCursor", idOrPath),
  pickProjectParent: () => ipcRenderer.invoke("hub:pickProjectParent"),
  pickExistingProject: () => ipcRenderer.invoke("hub:pickExistingProject"),
  removeCrawler: (id) => ipcRenderer.invoke("hub:removeCrawler", id),
  startCrawler: (id, optionValues) =>
    ipcRenderer.invoke("hub:startCrawler", id, optionValues),
  stopCrawler: (id) => ipcRenderer.invoke("hub:stopCrawler", id),
  setProjectStartOptions: (id, payload) =>
    ipcRenderer.invoke("hub:setProjectStartOptions", id, payload),
  getProjectLogs: (id) => ipcRenderer.invoke("hub:getProjectLogs", id),
  followProjectLogs: (id) => ipcRenderer.invoke("hub:followProjectLogs", id),
  stopProjectLogs: (id) => ipcRenderer.invoke("hub:stopProjectLogs", id),
  pickEnvHelp: () => ipcRenderer.invoke("hub:pickEnvHelp"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onLog: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("hub:log", handler);
    return () => ipcRenderer.removeListener("hub:log", handler);
  },
  onProjectLog: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("project:log", handler);
    return () => ipcRenderer.removeListener("project:log", handler);
  },
  onUpdateStatus: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
});
