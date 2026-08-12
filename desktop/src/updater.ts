import {
  dialog,
  BrowserWindow,
  app,
  type BrowserWindow as BW,
} from "electron";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { UpdateStatusPayload } from "./shared/ipc";
import { Ipc } from "./shared/ipc";

let started = false;
let autoUpdater: typeof import("electron-updater").autoUpdater | null = null;
let pendingMacZip: string | null = null;

function getAutoUpdater() {
  if (!autoUpdater) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ autoUpdater } = require("electron-updater") as typeof import("electron-updater"));
    autoUpdater.autoDownload = false;
    // ShipIt (Squirrel.Mac) rejects unsigned/ad-hoc zips — we install manually on darwin.
    autoUpdater.autoInstallOnAppQuit = process.platform !== "darwin";
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.requestHeaders = {
      "Cache-Control":
        "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    };
  }
  return autoUpdater;
}

function send(win: BW | null, channel: string, payload: UpdateStatusPayload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function friendlyUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "unknown");
  if (/Code signature|podpis|did not pass validation|zasobów/i.test(raw)) {
    return "Podpis aktualizacji odrzucony (unsigned build). Pobierz nową wersję ręcznie z GitHub Releases.";
  }
  if (/ERR_HTTP2|HTTP2|REFUSED_STREAM|PROTOCOL_ERROR/i.test(raw)) {
    return "GitHub odmówił połączenia HTTP/2. Spróbuj ponownie za chwilę albo pobierz release ręcznie.";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(raw)) {
    return `Brak połączenia z serwerem aktualizacji (${raw}).`;
  }
  return raw;
}

function rememberDownloadedZip(): void {
  try {
    const helper = (getAutoUpdater() as unknown as {
      downloadedUpdateHelper?: { file?: string | null };
    }).downloadedUpdateHelper;
    const file = helper?.file;
    if (file && fs.existsSync(file)) pendingMacZip = file;
  } catch {
    /* ignore */
  }
}

function currentAppBundle(): string {
  // .../Exitly.app/Contents/MacOS/Exitly → .../Exitly.app
  return path.resolve(process.execPath, "..", "..", "..");
}

/** Replace running .app from an unsigned zip without ShipIt signature checks. */
function installMacUpdateFromZip(zipPath: string): void {
  const appBundle = currentAppBundle();
  if (!appBundle.endsWith(".app") || !fs.existsSync(zipPath)) {
    throw new Error(`Brak zipa aktualizacji lub ścieżki .app (${zipPath})`);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "exitly-update-"));
  const script = path.join(staging, "install.sh");
  const logFile = path.join(staging, "install.log");
  const pid = process.pid;

  const sh = `#!/bin/bash
set -euo pipefail
exec >>${JSON.stringify(logFile)} 2>&1
echo "Exitly unsigned update $(date)"
ZIP=${JSON.stringify(zipPath)}
APP=${JSON.stringify(appBundle)}
STAGE=${JSON.stringify(staging)}
PID=${pid}

# Wait until this Electron process exits
for i in $(seq 1 120); do
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  sleep 0.25
done
sleep 0.5

EXTRACT="$STAGE/extract"
mkdir -p "$EXTRACT"
ditto -x -k "$ZIP" "$EXTRACT"
NEW_APP="$(find "$EXTRACT" -maxdepth 3 -name '*.app' -type d | head -1)"
if [ -z "$NEW_APP" ] || [ ! -d "$NEW_APP" ]; then
  echo "No .app in zip"; exit 1
fi

xattr -cr "$NEW_APP" || true
PARENT="$(dirname "$APP")"
NAME="$(basename "$APP")"
BACKUP="$STAGE/$NAME.bak"
rm -rf "$BACKUP"
if [ -d "$APP" ]; then
  mv "$APP" "$BACKUP"
fi
ditto "$NEW_APP" "$APP"
xattr -cr "$APP" || true
open "$APP"
echo "Installed OK"
`;

  fs.writeFileSync(script, sh, { mode: 0o755 });
  const child = spawn("/bin/bash", [script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  app.quit();
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
    rememberDownloadedZip();
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "downloaded",
      version: info.version,
    });
  });

  updater.on("error", (err) => {
    send(getMainWindow(), Ipc.push.updateStatus, {
      state: "error",
      message: friendlyUpdateError(err),
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
    const message = friendlyUpdateError(err);
    if (!silent) {
      const win = BrowserWindow.getFocusedWindow();
      await dialog.showMessageBox(win || undefined!, {
        type: "error",
        title: "Aktualizacja",
        message: "Nie udało się sprawdzić aktualizacji",
        detail: message,
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
  rememberDownloadedZip();
  return true;
}

export function quitAndInstall(): void {
  if (process.platform === "darwin") {
    rememberDownloadedZip();
    if (!pendingMacZip) {
      void dialog.showMessageBox({
        type: "error",
        title: "Aktualizacja",
        message: "Brak pobranego pliku aktualizacji",
        detail: "Pobierz update ponownie albo zainstaluj ręcznie z GitHub Releases.",
      });
      return;
    }
    try {
      installMacUpdateFromZip(pendingMacZip);
    } catch (err) {
      void dialog.showMessageBox({
        type: "error",
        title: "Aktualizacja",
        message: "Nie udało się zainstalować aktualizacji",
        detail: friendlyUpdateError(err),
      });
    }
    return;
  }
  getAutoUpdater().quitAndInstall(false, true);
}
