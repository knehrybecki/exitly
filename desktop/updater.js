const { dialog, BrowserWindow, app } = require("electron");

let started = false;
let autoUpdater = null;

function getAutoUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require("electron-updater"));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
  }
  return autoUpdater;
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function setupAutoUpdater(getMainWindow) {
  if (started) return;
  started = true;
  const updater = getAutoUpdater();

  updater.on("checking-for-update", () => {
    send(getMainWindow(), "update:status", { state: "checking" });
  });

  updater.on("update-available", (info) => {
    send(getMainWindow(), "update:status", {
      state: "available",
      version: info.version,
      releaseNotes: info.releaseNotes || "",
    });
  });

  updater.on("update-not-available", (info) => {
    send(getMainWindow(), "update:status", {
      state: "not-available",
      version: info.version,
    });
  });

  updater.on("download-progress", (p) => {
    send(getMainWindow(), "update:status", {
      state: "downloading",
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    });
  });

  updater.on("update-downloaded", (info) => {
    send(getMainWindow(), "update:status", {
      state: "downloaded",
      version: info.version,
    });
  });

  updater.on("error", (err) => {
    send(getMainWindow(), "update:status", {
      state: "error",
      message: err == null ? "unknown" : err.message || String(err),
    });
  });
}

async function checkForUpdates({ silent = false } = {}) {
  if (!app.isPackaged) {
    return { ok: false, reason: "dev" };
  }
  try {
    const result = await getAutoUpdater().checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo || null };
  } catch (err) {
    if (!silent) {
      const win = BrowserWindow.getFocusedWindow();
      await dialog.showMessageBox(win || undefined, {
        type: "error",
        title: "Update check failed",
        message: err.message || String(err),
      });
    }
    return { ok: false, reason: err.message };
  }
}

async function downloadUpdate() {
  if (!app.isPackaged) {
    throw new Error("Updates only work in packaged builds");
  }
  await getAutoUpdater().downloadUpdate();
  return true;
}

function quitAndInstall() {
  getAutoUpdater().quitAndInstall(false, true);
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
};
