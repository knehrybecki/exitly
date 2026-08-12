import { contextBridge, ipcRenderer } from "electron";
import { Ipc } from "./shared/ipc";
import type { ProjectLogPayload, UpdateStatusPayload } from "./shared/ipc";

const vpnHub = {
  getAppInfo: () => ipcRenderer.invoke(Ipc.hub.getAppInfo),
  getSnapshot: () => ipcRenderer.invoke(Ipc.hub.getSnapshot),
  getOllama: () => ipcRenderer.invoke(Ipc.hub.getOllama),
  setOllama: (input: unknown) => ipcRenderer.invoke(Ipc.hub.setOllama, input),
  checkOllama: (baseUrl?: string) =>
    ipcRenderer.invoke(Ipc.hub.checkOllama, baseUrl),
  getSerper: () => ipcRenderer.invoke(Ipc.hub.getSerper),
  setSerper: (input: unknown) => ipcRenderer.invoke(Ipc.hub.setSerper, input),
  checkSerper: (apiKey?: string) =>
    ipcRenderer.invoke(Ipc.hub.checkSerper, apiKey),
  getHostWg: () => ipcRenderer.invoke(Ipc.hub.getHostWg),
  setHostWg: (input: unknown) => ipcRenderer.invoke(Ipc.hub.setHostWg, input),
  testHostWg: () => ipcRenderer.invoke(Ipc.hub.testHostWg),
  testProjectMcp: (id: string) =>
    ipcRenderer.invoke(Ipc.hub.testProjectMcp, id),
  setProjectUseHostWg: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(Ipc.hub.setProjectUseHostWg, id, enabled),
  setProjectCliShell: (id: string, payload: unknown) =>
    ipcRenderer.invoke(Ipc.hub.setProjectCliShell, id, payload),
  setupEnv: (privateKey: string) =>
    ipcRenderer.invoke(Ipc.hub.setupEnv, privateKey),
  connect: (country: string) => ipcRenderer.invoke(Ipc.hub.connect, country),
  disconnect: () => ipcRenderer.invoke(Ipc.hub.disconnect),
  refreshIp: () => ipcRenderer.invoke(Ipc.hub.refreshIp),
  checkProjectIp: (id: string) =>
    ipcRenderer.invoke(Ipc.hub.checkProjectIp, id),
  createProject: (input: unknown) =>
    ipcRenderer.invoke(Ipc.hub.createProject, input),
  registerProject: (input: unknown) =>
    ipcRenderer.invoke(Ipc.hub.registerProject, input),
  duplicateProject: (input: unknown) =>
    ipcRenderer.invoke(Ipc.hub.duplicateProject, input),
  exportProject: (id: string) => ipcRenderer.invoke(Ipc.hub.exportProject, id),
  importProject: () => ipcRenderer.invoke(Ipc.hub.importProject),
  setCrawlerExit: (id: string, exit: string) =>
    ipcRenderer.invoke(Ipc.hub.setCrawlerExit, id, exit),
  setProjectModels: (id: string, models: unknown) =>
    ipcRenderer.invoke(Ipc.hub.setProjectModels, id, models),
  getProjectEnv: (id: string) => ipcRenderer.invoke(Ipc.hub.getProjectEnv, id),
  setProjectEnv: (id: string, values: unknown) =>
    ipcRenderer.invoke(Ipc.hub.setProjectEnv, id, values),
  openInCursor: (idOrPath: string) =>
    ipcRenderer.invoke(Ipc.hub.openInCursor, idOrPath),
  pickProjectParent: () => ipcRenderer.invoke(Ipc.hub.pickProjectParent),
  pickExistingProject: () => ipcRenderer.invoke(Ipc.hub.pickExistingProject),
  removeCrawler: (id: string) => ipcRenderer.invoke(Ipc.hub.removeCrawler, id),
  startCrawler: (id: string, optionValues?: unknown) =>
    ipcRenderer.invoke(Ipc.hub.startCrawler, id, optionValues),
  stopCrawler: (id: string) => ipcRenderer.invoke(Ipc.hub.stopCrawler, id),
  setProjectStartOptions: (id: string, payload: unknown) =>
    ipcRenderer.invoke(Ipc.hub.setProjectStartOptions, id, payload),
  getProjectLogs: (id: string) =>
    ipcRenderer.invoke(Ipc.hub.getProjectLogs, id),
  followProjectLogs: (id: string) =>
    ipcRenderer.invoke(Ipc.hub.followProjectLogs, id),
  stopProjectLogs: (id: string) =>
    ipcRenderer.invoke(Ipc.hub.stopProjectLogs, id),
  pickEnvHelp: () => ipcRenderer.invoke(Ipc.hub.pickEnvHelp),
  checkForUpdates: () => ipcRenderer.invoke(Ipc.update.check),
  downloadUpdate: () => ipcRenderer.invoke(Ipc.update.download),
  installUpdate: () => ipcRenderer.invoke(Ipc.update.install),
  onLog: (cb: (line: string) => void) => {
    const handler = (_event: unknown, line: string) => cb(line);
    ipcRenderer.on(Ipc.push.hubLog, handler);
    return () => ipcRenderer.removeListener(Ipc.push.hubLog, handler);
  },
  onProjectLog: (cb: (payload: ProjectLogPayload) => void) => {
    const handler = (_event: unknown, payload: ProjectLogPayload) => cb(payload);
    ipcRenderer.on(Ipc.push.projectLog, handler);
    return () => ipcRenderer.removeListener(Ipc.push.projectLog, handler);
  },
  onUpdateStatus: (cb: (payload: UpdateStatusPayload) => void) => {
    const handler = (_event: unknown, payload: UpdateStatusPayload) =>
      cb(payload);
    ipcRenderer.on(Ipc.push.updateStatus, handler);
    return () => ipcRenderer.removeListener(Ipc.push.updateStatus, handler);
  },
};

contextBridge.exposeInMainWorld("vpnHub", vpnHub);

export type VpnHubApi = typeof vpnHub;
