import type { Snapshot } from "./types";

export type VpnHubApi = {
  getAppInfo: () => Promise<{ version: string; packaged: boolean }>;
  getSnapshot: () => Promise<Snapshot>;
  getOllama: () => Promise<Record<string, unknown>>;
  setOllama: (input: unknown) => Promise<Snapshot>;
  checkOllama: (baseUrl?: string) => Promise<{
    ok?: boolean;
    models?: string[];
    error?: string;
  }>;
  getSerper: () => Promise<Record<string, unknown>>;
  setSerper: (input: unknown) => Promise<Snapshot>;
  checkSerper: (apiKey?: string) => Promise<{
    ok?: boolean;
    masked?: string;
    error?: string;
  }>;
  getHostWg: () => Promise<Record<string, unknown>>;
  setHostWg: (input: unknown) => Promise<Snapshot>;
  testHostWg: () => Promise<unknown>;
  testProjectMcp: (id: string) => Promise<{
    ok?: boolean;
    host?: string;
    port?: string | number;
    error?: string;
  }>;
  setProjectUseHostWg: (id: string, enabled: boolean) => Promise<Snapshot>;
  setProjectCliShell: (id: string, payload: unknown) => Promise<Snapshot>;
  setupEnv: (privateKey: string) => Promise<Snapshot>;
  checkProjectIp: (id: string) => Promise<import("./types").ProjectIpInfo>;
  createProject: (input: unknown) => Promise<Snapshot>;
  registerProject: (input: unknown) => Promise<Snapshot>;
  duplicateProject: (input: unknown) => Promise<Snapshot>;
  exportProject: (id: string) => Promise<{ path?: string } | null>;
  importProject: () => Promise<Snapshot | null>;
  setCrawlerExit: (id: string, exit: string) => Promise<Snapshot>;
  setProjectModels: (id: string, models: unknown) => Promise<Snapshot>;
  getProjectEnv: (id: string) => Promise<import("./types").ProjectEnvData>;
  setProjectEnv: (id: string, values: unknown) => Promise<Snapshot>;
  openInCursor: (idOrPath: string) => Promise<unknown>;
  pickProjectParent: () => Promise<string | null>;
  pickExistingProject: () => Promise<string | null>;
  removeCrawler: (id: string) => Promise<Snapshot>;
  startCrawler: (id: string, optionValues?: unknown) => Promise<Snapshot>;
  stopCrawler: (id: string) => Promise<Snapshot>;
  setProjectStartOptions: (id: string, payload: unknown) => Promise<Snapshot>;
  getProjectLogs: (id: string) => Promise<{ text?: string } | string>;
  followProjectLogs: (id: string) => Promise<unknown>;
  stopProjectLogs: (id: string) => Promise<unknown>;
  pickEnvHelp: () => Promise<unknown>;
  checkForUpdates: () => Promise<{ reason?: string } | null | undefined>;
  downloadUpdate: () => Promise<unknown>;
  installUpdate: () => Promise<unknown>;
  onLog: (cb: (line: string) => void) => () => void;
  onProjectLog: (cb: (payload: { id: string; line: string }) => void) => () => void;
  onUpdateStatus: (
    cb: (payload: import("./types").UpdateStatusPayload) => void,
  ) => () => void;
};

declare global {
  interface Window {
    vpnHub: VpnHubApi;
  }
}

export function api(): VpnHubApi {
  const hub = window.vpnHub;
  if (!hub) {
    throw new Error("vpnHub niedostępne — preload nie załadował się (sandbox / build).");
  }
  return hub;
}
