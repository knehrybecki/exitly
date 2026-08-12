import { app, BrowserWindow, shell } from "electron";
import type { BrowserWindow as BW } from "electron";
import { Ipc } from "../shared/ipc";
import * as updater from "../updater";
import { applyAppIcon, createMainWindow } from "./window";
import { hub, registerIpcHandlers } from "./ipc";

// electron-updater + GitHub/Fastly: HTTP/2 often throws ERR_HTTP2_SERVER_REFUSED_STREAM
app.commandLine.appendSwitch("disable-http2");

let mainWindow: BW | null = null;

function sendLog(line: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(Ipc.push.hubLog, line);
  }
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

  registerIpcHandlers(() => mainWindow, sendLog);

  app.whenReady().then(() => {
    applyAppIcon(null);
    hub.ensureWorkspace();
    mainWindow = createMainWindow();
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    updater.setupAutoUpdater(() => mainWindow);

    hub.startHostWgWatchdog({ onLog: sendLog });
    hub
      .syncAppHostWg({ onLog: sendLog, allowAdminPrompt: true })
      .then((res) => {
        if (res && res.ok && !res.skipped) {
          sendLog(
            res.already
              ? `CRM LAN: tunel ${res.name || "wg0"} aktywny (Exitly)`
              : `CRM LAN: Exitly podniosło ${res.name || "wg0"}`,
          );
        } else if (res && res.error) {
          sendLog(`CRM LAN: ${res.error}`);
        }
      })
      .catch((err: unknown) => {
        sendLog(
          `CRM LAN: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    setTimeout(() => {
      void updater.checkForUpdates({ silent: true });
    }, 4000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
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
