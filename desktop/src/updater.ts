import {
  dialog,
  BrowserWindow,
  app,
  type BrowserWindow as BW,
} from "electron";
import type { UpdateStatusPayload } from "./shared/ipc";
import { Ipc } from "./shared/ipc";

let started = false;
let autoUpdater: typeof import("electron-updater").autoUpdater | null = null;

function getAutoUpdater() {
  if (!autoUpdater) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ autoUpdater } = require("electron-updater") as typeof import("electron-updater"));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
  }
  return autoUpdater;
}

function send(win: BW | null, channel: string, payload: UpdateStatusPayload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

export function setupAutoUpdater(getMainWindow: () => BW | null): void {
  if (started) return;
  started = true;
  const updater = getAutoUpdater();

  updater.on("checking-for-update", () => {
    send(getMainWindow(), Ipc.push.updateStatus, { state: "checking" });
  });

  updater.on("update-available", (info) => {
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "available",
      version: info.version,
      releaseNotes: String(info.releaseNotes || ""),
    });
  });

  updater.on("update-not-available", (info) => {
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "not-available",
      version: info.version,
    });
  });

  updater.on("download-progress", (p) => {
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "downloading",
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    });
  });

  updater.on("update-downloaded", (info) => {
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "downloaded",
      version: info.version,
    });
  });

  updater.on("error", (err) => {
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "error",
      message: err == null ? "unknown" : err.message || String(err),
    });
  });
}

export async function checkForUpdates({
  silent = false,
}: { silent?: boolean } = {}) {
  if (!app.isPackaged) {
    return { ok: false as const, reason: "dev" };
  }
  try {
    const result = await getAutoUpdater().checkForUpdates();
    return { ok: true as const, updateInfo: result?.updateInfo || null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!silent) {
      const win = BrowserWindow.getFocusedWindow();
      await dialog.showMessageBox(win || undefined!, {
        type: "error",
        title: "Update check failed",
        message,
      });
    }
    return { ok: false as const, reason: message };
  }
}

export async function downloadUpdate(): Promise<true> {
  if (!app.isPackaged) {
    throw new Error("Updates only work in packaged builds");
  }
  await getAutoUpdater().downloadUpdate();
  return true;
}

export function quitAndInstall(): void {
  getAutoUpdater().quitAndInstall(false, true);
}
