import { app, dialog, ipcMain, type BrowserWindow } from "electron";
import { Ipc } from "../shared/ipc";
import * as updater from "../updater";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hub = require("../hub") as HubApi;

type HubApi = {
  getHubRoot: () => string;
  getSnapshot: (onLog?: (line: string) => void) => Promise<Record<string, unknown>>;
  readCountries: () => unknown[];
  getOllamaSettings: () => { enabled: boolean; baseUrl: string };
  setOllamaSettings: (input: unknown) => { enabled: boolean; baseUrl: string };
  checkOllama: (url: string) => Promise<unknown>;
  getSerperSettings: () => { enabled: boolean; apiKey: string };
  setSerperSettings: (input: unknown) => { enabled: boolean; apiKey: string };
  checkSerper: (apiKey?: string) => Promise<unknown>;
  getHostWgSettings: () => { configured: boolean; name: string };
  setHostWgSettings: (
    input: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => { configured: boolean; name: string };
  ensureHostWgUp: (opts?: {
    onLog?: (line: string) => void;
    allowAdminPrompt?: boolean;
  }) => Promise<unknown>;
  listCrawlersWithStatus: () => Promise<Array<Record<string, unknown>>>;
  probeProjectMcp: (
    projectPath: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<{ ok?: boolean; skipped?: boolean; error?: string }>;
  setProjectUseHostWg: (
    id: string,
    enabled: boolean,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  setProjectCliShell: (
    id: string,
    payload: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  setProjectModels: (
    id: string,
    models: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  getProjectEnv: (id: string) => Promise<unknown>;
  setProjectEnv: (
    id: string,
    values: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  setupEnv: (key: string) => Promise<unknown>;
  runVpn: (args: string[], onLog?: (line: string) => void) => Promise<string>;
  fetchIpInfo: (onLog?: (line: string) => void) => Promise<unknown>;
  checkProjectIp: (
    id: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  createProject: (
    input: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<{ name: string; id: string }>;
  registerProject: (
    input: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<{ name: string; id: string }>;
  duplicateProject: (
    input: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<{ name: string; id: string }>;
  exportProject: (
    id: string,
    dest: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<{ path: string }>;
  importProject: (
    input: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<{ name: string; id: string }>;
  setCrawlerExit: (
    id: string,
    exit: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  openInCursor: (
    target: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  removeCrawler: (
    id: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  startCrawler: (
    id: string,
    opts?: { onLog?: (line: string) => void; optionValues?: unknown },
  ) => Promise<unknown>;
  setProjectStartOptions: (
    id: string,
    payload: unknown,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  stopCrawler: (
    id: string,
    opts?: { onLog?: (line: string) => void },
  ) => Promise<unknown>;
  getProjectLogs: (id: string, opts?: { tail?: number }) => Promise<unknown>;
  followProjectLogs: (
    id: string,
    opts: { tail?: number; onLine: (line: string) => void },
  ) => unknown;
  stopProjectLogFollow: (id: string) => void;
  ensureWorkspace: () => void;
  startHostWgWatchdog: (opts?: { onLog?: (line: string) => void }) => void;
  stopHostWgWatchdog: () => void;
  syncAppHostWg: (opts?: {
    onLog?: (line: string) => void;
    allowAdminPrompt?: boolean;
  }) => Promise<{
    ok?: boolean;
    skipped?: boolean;
    already?: boolean;
    name?: string;
    error?: string;
  }>;
  stopAllProjectLogFollows: () => void;
  stopAllCliSessions?: () => void;
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  sendLog: (line: string) => void,
): void {
  const handle = (
    channel: string,
    fn: (...args: unknown[]) => unknown,
  ): void => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* ignore */
    }
    ipcMain.handle(channel, fn as never);
  };

  const win = () => getMainWindow();

  handle(Ipc.hub.getAppInfo, () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  }));

  handle(Ipc.hub.getSnapshot, async () => {
    try {
      return await hub.getSnapshot(sendLog);
    } catch (err) {
      return {
        ok: false,
        error: errMsg(err),
        countries: hub.readCountries(),
        setupNeeded: true,
      };
    }
  });

  handle(Ipc.hub.getOllama, () => hub.getOllamaSettings());
  handle(Ipc.hub.setOllama, async (_e, input) => {
    const ollama = hub.setOllamaSettings(input || {});
    sendLog(
      ollama.enabled
        ? `Ollama: włączona (${ollama.baseUrl})`
        : "Ollama: wyłączona",
    );
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.checkOllama, async (_e, baseUrl) => {
    const settings = hub.getOllamaSettings();
    const url =
      baseUrl != null && String(baseUrl).trim()
        ? String(baseUrl).trim()
        : settings.baseUrl;
    return hub.checkOllama(url);
  });

  handle(Ipc.hub.getSerper, () => hub.getSerperSettings());
  handle(Ipc.hub.setSerper, async (_e, input) => {
    const serper = hub.setSerperSettings(input || {});
    sendLog(
      serper.enabled && serper.apiKey
        ? "Serper: klucz zapisany (projekty dostaną SERPER_API_KEY)"
        : serper.enabled
          ? "Serper: włączony, ale brak klucza"
          : "Serper: wyłączony",
    );
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.checkSerper, async (_e, apiKey) =>
    hub.checkSerper(apiKey as string | undefined),
  );

  handle(Ipc.hub.getHostWg, () => hub.getHostWgSettings());
  handle(Ipc.hub.setHostWg, async (_e, input) => {
    const hostWg = hub.setHostWgSettings(input || {}, { onLog: sendLog });
    sendLog(
      hostWg.configured
        ? `Host WG: config ${hostWg.name} zapisany (włączasz per projekt)`
        : "Host WG: brak configu — wklej conf i Zapisz",
    );
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.testHostWg, async () => {
    sendLog("Exitly: test tunelu CRM (host WG)…");
    await hub.ensureHostWgUp({ onLog: sendLog, allowAdminPrompt: true });
    return { ok: true, hostWg: hub.getHostWgSettings() };
  });

  handle(Ipc.hub.testProjectMcp, async (_e, id) => {
    const list = await hub.listCrawlersWithStatus();
    const hit = list.find((c) => c.id === String(id || ""));
    if (!hit || !hit.path) throw new Error("Projekt nie znaleziony");
    if (hit.useHostWg) {
      await hub.ensureHostWgUp({ onLog: sendLog });
    }
    const mcp = await hub.probeProjectMcp(String(hit.path), {
      onLog: sendLog,
    });
    if (!mcp.ok && !mcp.skipped) {
      throw new Error(mcp.error || "MCP offline");
    }
    return mcp;
  });

  handle(Ipc.hub.setProjectUseHostWg, async (_e, id, enabled) => {
    await hub.setProjectUseHostWg(String(id || ""), !!enabled, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.setProjectCliShell, async (_e, id, payload) => {
    await hub.setProjectCliShell(String(id || ""), payload || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.setProjectModels, async (_e, id, models) => {
    await hub.setProjectModels(String(id || ""), models || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.getProjectEnv, async (_e, id) =>
    hub.getProjectEnv(String(id || "")),
  );
  handle(Ipc.hub.setProjectEnv, async (_e, id, values) => {
    await hub.setProjectEnv(String(id || ""), values || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });

  handle(Ipc.hub.setupEnv, async (_e, privateKey) =>
    hub.setupEnv(String(privateKey || "").trim()),
  );
  handle(Ipc.hub.connect, async (_e, country) => {
    const code = String(country || "")
      .trim()
      .toLowerCase();
    if (!code) throw new Error("Wybierz kraj");
    sendLog(`Łączę → ${code.toUpperCase()}…`);
    const out = await hub.runVpn(["use", code], sendLog);
    sendLog(String(out || "Połączono.").trim());
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.disconnect, async () => {
    sendLog("Rozłączam…");
    const out = await hub.runVpn(["down"], sendLog);
    sendLog(String(out || "Rozłączono.").trim());
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.refreshIp, async () => hub.fetchIpInfo(sendLog));
  handle(Ipc.hub.checkProjectIp, async (_e, id) =>
    hub.checkProjectIp(String(id || ""), { onLog: sendLog }),
  );

  handle(Ipc.hub.createProject, async (_e, input) => {
    const crawler = await hub.createProject(input || {}, { onLog: sendLog });
    sendLog(`Utworzono projekt: ${crawler.name}`);
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.registerProject, async (_e, input) => {
    const crawler = await hub.registerProject(input || {}, {
      onLog: sendLog,
    });
    sendLog(`Dodano projekt: ${crawler.name}`);
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.duplicateProject, async (_e, input) => {
    const crawler = await hub.duplicateProject(input || {}, {
      onLog: sendLog,
    });
    sendLog(`Zduplikowano projekt: ${crawler.name}`);
    const snap = await hub.getSnapshot(sendLog);
    return { ...snap, duplicatedProjectId: crawler.id };
  });

  handle(Ipc.hub.exportProject, async (_e, id) => {
    const mainWindow = win();
    const list = await hub.listCrawlersWithStatus();
    const hit = list.find((c) => c.id === String(id || ""));
    const defaultName = `${
      String(hit?.name || "project")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "project"
    }.exitly.zip`;
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Eksportuj projekt",
      defaultPath: defaultName,
      filters: [
        { name: "Exitly project", extensions: ["zip"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    let dest = result.filePath;
    if (!/\.zip$/i.test(dest)) dest = `${dest}.zip`;
    const out = await hub.exportProject(String(id || ""), dest, {
      onLog: sendLog,
    });
    sendLog(`Eksport OK: ${out.path}`);
    return out;
  });

  handle(Ipc.hub.importProject, async () => {
    const mainWindow = win();
    const zipPick = await dialog.showOpenDialog(mainWindow!, {
      title: "Importuj projekt (.zip)",
      properties: ["openFile"],
      filters: [
        { name: "Exitly / ZIP", extensions: ["zip"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (zipPick.canceled || !zipPick.filePaths.length) return null;
    const parentPick = await dialog.showOpenDialog(mainWindow!, {
      title: "Folder docelowy dla importu",
      properties: ["openDirectory", "createDirectory"],
    });
    if (parentPick.canceled || !parentPick.filePaths.length) return null;
    const crawler = await hub.importProject(
      {
        zipPath: zipPick.filePaths[0],
        parentDir: parentPick.filePaths[0],
      },
      { onLog: sendLog },
    );
    sendLog(`Zaimportowano: ${crawler.name}`);
    const snap = await hub.getSnapshot(sendLog);
    return { ...snap, importedProjectId: crawler.id };
  });

  handle(Ipc.hub.setCrawlerExit, async (_e, id, exit) => {
    await hub.setCrawlerExit(String(id || ""), String(exit || ""), {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.openInCursor, async (_e, idOrPath) => {
    const value = String(idOrPath || "");
    let target = value;
    try {
      const list = await hub.listCrawlersWithStatus();
      const hit = list.find((c) => c.id === value);
      if (hit && hit.path) target = String(hit.path);
    } catch {
      /* path */
    }
    await hub.openInCursor(target, { onLog: sendLog });
    return true;
  });
  handle(Ipc.hub.pickProjectParent, async () => {
    const result = await dialog.showOpenDialog(win()!, {
      title: "Wybierz folder nadrzędny",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  handle(Ipc.hub.pickExistingProject, async () => {
    const result = await dialog.showOpenDialog(win()!, {
      title: "Otwórz projekt (Docker lub CLI)",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle(Ipc.hub.removeCrawler, async (_e, id) => {
    sendLog("Usuwam z listy…");
    await hub.removeCrawler(String(id || ""), { onLog: sendLog });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.startCrawler, async (_e, id, optionValues) => {
    await hub.startCrawler(String(id || ""), {
      onLog: sendLog,
      optionValues: optionValues || undefined,
    });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.setProjectStartOptions, async (_e, id, payload) => {
    await hub.setProjectStartOptions(String(id || ""), payload || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.stopCrawler, async (_e, id) => {
    await hub.stopCrawler(String(id || ""), { onLog: sendLog });
    return hub.getSnapshot(sendLog);
  });
  handle(Ipc.hub.getProjectLogs, async (_e, id) =>
    hub.getProjectLogs(String(id || ""), { tail: 250 }),
  );
  handle(Ipc.hub.followProjectLogs, async (_e, id) => {
    const projectId = String(id || "");
    hub.followProjectLogs(projectId, {
      tail: 120,
      onLine: (line) => {
        const mainWindow = win();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(Ipc.push.projectLog, {
            id: projectId,
            line,
          });
        }
      },
    });
    return true;
  });
  handle(Ipc.hub.stopProjectLogs, async (_e, id) => {
    hub.stopProjectLogFollow(String(id || ""));
    return true;
  });
  handle(Ipc.hub.pickEnvHelp, async () => {
    await dialog.showMessageBox(win()!, {
      type: "info",
      title: "Klucz WireGuard",
      message: "Jak pobrać klucz Proton WireGuard",
      detail:
        "1. Wejdź na konto Proton → VPN → WireGuard\n" +
        "2. Wygeneruj konfigurację (dowolny serwer)\n" +
        "3. Skopiuj wartość PrivateKey\n" +
        "4. Wklej tutaj i kliknij Zapisz\n\n" +
        "Jeden klucz działa dla wszystkich krajów.",
      buttons: ["OK"],
    });
  });

  handle(Ipc.update.check, async () =>
    updater.checkForUpdates({ silent: false }),
  );
  handle(Ipc.update.download, async () => updater.downloadUpdate());
  handle(Ipc.update.install, () => {
    updater.quitAndInstall();
  });
}

export { hub };
