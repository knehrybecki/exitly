const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const hub = require("./hub");
const updater = require("./updater");

let mainWindow = null;

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, "build", "icon.png"),
    path.join(__dirname, "renderer", "assets", "icon.png"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return null;
}

function applyAppIcon(win) {
  const icon = resolveAppIcon();
  if (!icon) return;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }
  if (win && process.platform !== "darwin") {
    win.setIcon(icon);
  }
}

function createWindow() {
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    title: "Exitly",
    backgroundColor: "#030806",
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyAppIcon(mainWindow);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function sendLog(line) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hub:log", line);
  }
}

function registerIpcHandlers() {
  const handle = (channel, fn) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* ignore */
    }
    ipcMain.handle(channel, fn);
  };

  handle("hub:getRoot", () => hub.getHubRoot());

  handle("hub:getAppInfo", () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  }));

  handle("hub:getSnapshot", async () => {
    try {
      return await hub.getSnapshot(sendLog);
    } catch (err) {
      return {
        ok: false,
        error: err.message || String(err),
        countries: hub.readCountries(),
        setupNeeded: true,
      };
    }
  });

  handle("hub:getOllama", () => hub.getOllamaSettings());

  handle("hub:setOllama", async (_e, input) => {
    const ollama = hub.setOllamaSettings(input || {});
    sendLog(
      ollama.enabled
        ? `Ollama: włączona (${ollama.baseUrl})`
        : "Ollama: wyłączona"
    );
    return hub.getSnapshot(sendLog);
  });

  handle("hub:checkOllama", async (_e, baseUrl) => {
    const settings = hub.getOllamaSettings();
    const url =
      baseUrl != null && String(baseUrl).trim()
        ? String(baseUrl).trim()
        : settings.baseUrl;
    return hub.checkOllama(url);
  });

  handle("hub:getSerper", () => hub.getSerperSettings());

  handle("hub:setSerper", async (_e, input) => {
    const serper = hub.setSerperSettings(input || {});
    sendLog(
      serper.enabled && serper.apiKey
        ? "Serper: klucz zapisany (projekty dostaną SERPER_API_KEY)"
        : serper.enabled
          ? "Serper: włączony, ale brak klucza"
          : "Serper: wyłączony"
    );
    return hub.getSnapshot(sendLog);
  });

  handle("hub:checkSerper", async (_e, apiKey) => {
    return hub.checkSerper(apiKey);
  });

  handle("hub:getHostWg", () => hub.getHostWgSettings());

  handle("hub:setHostWg", async (_e, input) => {
    const hostWg = hub.setHostWgSettings(input || {}, { onLog: sendLog });
    sendLog(
      hostWg.configured
        ? `Host WG: config ${hostWg.name} zapisany (włączasz per projekt)`
        : "Host WG: brak configu — wklej conf i zapisz"
    );
    return hub.getSnapshot(sendLog);
  });

  handle("hub:testHostWg", async () => {
    sendLog("Exitly: test tunelu CRM (host WG)…");
    await hub.ensureHostWgUp({ onLog: sendLog, allowAdminPrompt: true });
    return { ok: true, hostWg: hub.getHostWgSettings() };
  });

  handle("hub:testProjectMcp", async (_e, id) => {
    const list = await hub.listCrawlersWithStatus();
    const hit = list.find((c) => c.id === String(id || ""));
    if (!hit || !hit.path) throw new Error("Projekt nie znaleziony");
    if (hit.useHostWg) {
      await hub.ensureHostWgUp({ onLog: sendLog });
    }
    const mcp = await hub.probeProjectMcp(hit.path, { onLog: sendLog });
    if (!mcp.ok && !mcp.skipped) {
      throw new Error(mcp.error || "MCP offline");
    }
    return mcp;
  });

  handle("hub:setProjectUseHostWg", async (_e, id, enabled) => {
    await hub.setProjectUseHostWg(String(id || ""), !!enabled, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:setProjectCliShell", async (_e, id, payload) => {
    await hub.setProjectCliShell(String(id || ""), payload || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:setProjectModels", async (_e, id, models) => {
    await hub.setProjectModels(String(id || ""), models || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:getProjectEnv", async (_e, id) => {
    return hub.getProjectEnv(String(id || ""));
  });

  handle("hub:setProjectEnv", async (_e, id, values) => {
    await hub.setProjectEnv(String(id || ""), values || {}, { onLog: sendLog });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:setupEnv", async (_e, privateKey) => {
    return hub.setupEnv(String(privateKey || "").trim());
  });

  handle("hub:connect", async (_e, country) => {
    const code = String(country || "").trim().toLowerCase();
    if (!code) throw new Error("Wybierz kraj");
    sendLog(`Łączę → ${code.toUpperCase()}…`);
    const out = await hub.runVpn(["use", code], sendLog);
    sendLog(String(out || "Połączono.").trim());
    return hub.getSnapshot(sendLog);
  });

  handle("hub:disconnect", async () => {
    sendLog("Rozłączam…");
    const out = await hub.runVpn(["down"], sendLog);
    sendLog(String(out || "Rozłączono.").trim());
    return hub.getSnapshot(sendLog);
  });

  handle("hub:refreshIp", async () => {
    return hub.fetchIpInfo(sendLog);
  });

  handle("hub:checkProjectIp", async (_e, id) => {
    if (typeof hub.checkProjectIp !== "function") {
      throw new Error("checkProjectIp niedostępne — zrestartuj Exitly");
    }
    return hub.checkProjectIp(String(id || ""), { onLog: sendLog });
  });

  handle("hub:createProject", async (_e, input) => {
    const crawler = await hub.createProject(input || {}, { onLog: sendLog });
    sendLog(`Utworzono projekt: ${crawler.name}`);
    return hub.getSnapshot(sendLog);
  });

  handle("hub:registerProject", async (_e, input) => {
    const crawler = await hub.registerProject(input || {}, { onLog: sendLog });
    sendLog(`Dodano projekt: ${crawler.name}`);
    return hub.getSnapshot(sendLog);
  });

  handle("hub:duplicateProject", async (_e, input) => {
    const crawler = await hub.duplicateProject(input || {}, { onLog: sendLog });
    sendLog(`Zduplikowano projekt: ${crawler.name}`);
    const snap = await hub.getSnapshot(sendLog);
    return { ...snap, duplicatedProjectId: crawler.id };
  });

  handle("hub:exportProject", async (_e, id) => {
    const list = await hub.listCrawlersWithStatus();
    const hit = list.find((c) => c.id === String(id || ""));
    const defaultName = `${(hit?.name || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"}.exitly.zip`;
    const result = await dialog.showSaveDialog(mainWindow, {
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
    const out = await hub.exportProject(String(id || ""), dest, { onLog: sendLog });
    sendLog(`Eksport OK: ${out.path}`);
    return out;
  });

  handle("hub:importProject", async (_e) => {
    const zipPick = await dialog.showOpenDialog(mainWindow, {
      title: "Importuj projekt (.zip)",
      properties: ["openFile"],
      filters: [
        { name: "Exitly / ZIP", extensions: ["zip"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (zipPick.canceled || !zipPick.filePaths.length) return null;
    const parentPick = await dialog.showOpenDialog(mainWindow, {
      title: "Folder docelowy dla importu",
      properties: ["openDirectory", "createDirectory"],
    });
    if (parentPick.canceled || !parentPick.filePaths.length) return null;
    const crawler = await hub.importProject(
      {
        zipPath: zipPick.filePaths[0],
        parentDir: parentPick.filePaths[0],
      },
      { onLog: sendLog }
    );
    sendLog(`Zaimportowano: ${crawler.name}`);
    const snap = await hub.getSnapshot(sendLog);
    return { ...snap, importedProjectId: crawler.id };
  });

  handle("hub:setCrawlerExit", async (_e, id, exit) => {
    await hub.setCrawlerExit(String(id || ""), String(exit || ""), {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:openInCursor", async (_e, idOrPath) => {
    const value = String(idOrPath || "");
    let target = value;
    try {
      const list = await hub.listCrawlersWithStatus();
      const hit = list.find((c) => c.id === value);
      if (hit && hit.path) target = hit.path;
    } catch {
      /* użyj ścieżki */
    }
    await hub.openInCursor(target, { onLog: sendLog });
    return true;
  });

  handle("hub:pickProjectParent", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Wybierz folder nadrzędny",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle("hub:pickExistingProject", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Otwórz projekt (Docker lub CLI)",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle("hub:removeCrawler", async (_e, id) => {
    sendLog("Usuwam z listy…");
    await hub.removeCrawler(String(id || ""), { onLog: sendLog });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:startCrawler", async (_e, id, optionValues) => {
    await hub.startCrawler(String(id || ""), {
      onLog: sendLog,
      optionValues: optionValues || undefined,
    });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:setProjectStartOptions", async (_e, id, payload) => {
    await hub.setProjectStartOptions(String(id || ""), payload || {}, {
      onLog: sendLog,
    });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:stopCrawler", async (_e, id) => {
    await hub.stopCrawler(String(id || ""), { onLog: sendLog });
    return hub.getSnapshot(sendLog);
  });

  handle("hub:getProjectLogs", async (_e, id) => {
    return hub.getProjectLogs(String(id || ""), { tail: 250 });
  });

  handle("hub:followProjectLogs", async (_e, id) => {
    const projectId = String(id || "");
    hub.followProjectLogs(projectId, {
      tail: 120,
      onLine: (line) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("project:log", { id: projectId, line });
        }
      },
    });
    return true;
  });

  handle("hub:stopProjectLogs", async (_e, id) => {
    hub.stopProjectLogFollow(String(id || ""));
    return true;
  });

  handle("hub:pickEnvHelp", async () => {
    await dialog.showMessageBox(mainWindow, {
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

  handle("update:check", async () =>
    updater.checkForUpdates({ silent: false })
  );
  handle("update:download", async () => updater.downloadUpdate());
  handle("update:install", () => {
    updater.quitAndInstall();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  registerIpcHandlers();

  app.whenReady().then(() => {
    applyAppIcon(null);
    hub.ensureWorkspace();
    createWindow();
    updater.setupAutoUpdater(() => mainWindow);

    // CRM LAN: Exitly samo trzyma wg0 gdy projekt ma „CRM (Exitly)”
    hub.startHostWgWatchdog({ onLog: sendLog });
    hub.syncAppHostWg({ onLog: sendLog, allowAdminPrompt: true }).then((res) => {
      if (res && res.ok && !res.skipped) {
        sendLog(
          res.already
            ? `CRM LAN: tunel ${res.name || "wg0"} aktywny (Exitly)`
            : `CRM LAN: Exitly podniosło ${res.name || "wg0"}`,
        );
      } else if (res && res.error) {
        sendLog(`CRM LAN: ${res.error}`);
      }
    }).catch((err) => {
      sendLog(`CRM LAN: ${err.message || err}`);
    });

    // Auto-check a few seconds after launch (packaged only)
    setTimeout(() => {
      updater.checkForUpdates({ silent: true });
    }, 4000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  hub.stopHostWgWatchdog();
  hub.stopAllProjectLogFollows();
  if (typeof hub.stopAllCliSessions === "function") {
    hub.stopAllCliSessions();
  }
});
