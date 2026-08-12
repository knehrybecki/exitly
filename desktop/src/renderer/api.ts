export type VpnHubApi = {
  getAppInfo: () => Promise<{ version: string; packaged: boolean }>;
  getSnapshot: () => Promise<Record<string, unknown>>;
  getOllama: () => Promise<Record<string, unknown>>;
  setOllama: (input: unknown) => Promise<Record<string, unknown>>;
  checkOllama: (baseUrl?: string) => Promise<Record<string, unknown>>;
  getSerper: () => Promise<Record<string, unknown>>;
  setSerper: (input: unknown) => Promise<Record<string, unknown>>;
  checkSerper: (apiKey?: string) => Promise<Record<string, unknown>>;
  getHostWg: () => Promise<Record<string, unknown>>;
  setHostWg: (input: unknown) => Promise<Record<string, unknown>>;
  testHostWg: () => Promise<unknown>;
  testProjectMcp: (id: string) => Promise<Record<string, unknown>>;
  setProjectUseHostWg: (id: string, enabled: boolean) => Promise<Record<string, unknown>>;
  setProjectCliShell: (id: string, payload: unknown) => Promise<Record<string, unknown>>;
  setupEnv: (privateKey: string) => Promise<Record<string, unknown>>;
  checkProjectIp: (id: string) => Promise<Record<string, unknown>>;
  createProject: (input: unknown) => Promise<Record<string, unknown>>;
  registerProject: (input: unknown) => Promise<Record<string, unknown>>;
  duplicateProject: (input: unknown) => Promise<Record<string, unknown> & { duplicatedProjectId?: string }>;
  exportProject: (id: string) => Promise<{ path?: string } | null>;
  importProject: () => Promise<(Record<string, unknown> & { importedProjectId?: string }) | null>;
  setCrawlerExit: (id: string, exit: string) => Promise<Record<string, unknown>>;
  setProjectModels: (id: string, models: unknown) => Promise<Record<string, unknown>>;
  getProjectEnv: (id: string) => Promise<Record<string, unknown>>;
  setProjectEnv: (id: string, values: unknown) => Promise<Record<string, unknown>>;
  openInCursor: (idOrPath: string) => Promise<unknown>;
  pickProjectParent: () => Promise<string | null>;
  pickExistingProject: () => Promise<string | null>;
  removeCrawler: (id: string) => Promise<Record<string, unknown>>;
  startCrawler: (id: string, optionValues?: unknown) => Promise<Record<string, unknown>>;
  stopCrawler: (id: string) => Promise<Record<string, unknown>>;
  setProjectStartOptions: (id: string, payload: unknown) => Promise<Record<string, unknown>>;
  getProjectLogs: (id: string) => Promise<{ text?: string } | string>;
  followProjectLogs: (id: string) => Promise<unknown>;
  stopProjectLogs: (id: string) => Promise<unknown>;
  pickEnvHelp: () => Promise<unknown>;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  installUpdate: () => Promise<unknown>;
  onLog: (cb: (line: string) => void) => () => void;
  onProjectLog: (cb: (payload: { id: string; line: string }) => void) => () => void;
  onUpdateStatus: (cb: (payload: Record<string, unknown>) => void) => () => void;
};

declare global {
  interface Window {
    vpnHub: VpnHubApi;
  }
}

export function api(): VpnHubApi {
  const hub = window.vpnHub;
  if (!hub) {
    throw new Error(
      "vpnHub niedostępne — preload nie załadował się (sandbox / build).",
    );
  }
  return hub;
}
