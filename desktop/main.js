const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  clipboard,
  dialog,
} = require("electron");
const path = require("path");
const hub = require("./hub");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 740,
    minWidth: 760,
    minHeight: 620,
    title: "vpn-hub",
    backgroundColor: "#0e1412",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("hub:getRoot", () => hub.getHubRoot());

ipcMain.handle("hub:getSnapshot", async () => {
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

ipcMain.handle("hub:setupEnv", async (_e, privateKey) => {
  return hub.setupEnv(String(privateKey || "").trim());
});

ipcMain.handle("hub:connect", async (_e, country) => {
  const code = String(country || "").trim().toLowerCase();
  if (!code) throw new Error("Select a country");
  sendLog(`Connecting → ${code}…`);
  const out = await hub.runVpn(["use", code], sendLog);
  sendLog(out.trim() || "Connected.");
  return hub.getSnapshot(sendLog);
});

ipcMain.handle("hub:disconnect", async () => {
  sendLog("Disconnecting…");
  const out = await hub.runVpn(["down"], sendLog);
  sendLog(out.trim() || "Disconnected.");
  return hub.getSnapshot(sendLog);
});

ipcMain.handle("hub:refreshIp", async () => {
  return hub.fetchIpInfo(sendLog);
});

ipcMain.handle("hub:parallelUp", async (_e, codes) => {
  const list = (Array.isArray(codes) ? codes : [])
    .map((c) => String(c).toLowerCase())
    .filter(Boolean);
  if (!list.length) throw new Error("Pick at least one country");
  sendLog(`Starting parallel: ${list.join(", ")}…`);
  await hub.runVpn(["up", ...list], sendLog);
  return hub.getSnapshot(sendLog);
});

ipcMain.handle("hub:parallelDown", async (_e, codes) => {
  const list = (Array.isArray(codes) ? codes : [])
    .map((c) => String(c).toLowerCase())
    .filter(Boolean);
  if (!list.length) {
    await hub.runVpn(["down", "all"], sendLog);
  } else {
    await hub.runVpn(["down", ...list], sendLog);
  }
  return hub.getSnapshot(sendLog);
});

ipcMain.handle("hub:copy", (_e, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

ipcMain.handle("hub:openExternal", (_e, url) => {
  shell.openExternal(String(url));
});

ipcMain.handle("hub:revealRoot", () => {
  shell.openPath(hub.getHubRoot());
});

ipcMain.handle("hub:pickEnvHelp", async () => {
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "WireGuard private key",
    message: "Get your Proton WireGuard PrivateKey",
    detail:
      "1. Open Proton Account → VPN → WireGuard\n" +
      "2. Generate a config (any server)\n" +
      "3. Copy the PrivateKey value\n" +
      "4. Paste it here and click Save & continue\n\n" +
      "One key works for every country.",
    buttons: ["OK"],
  });
});
