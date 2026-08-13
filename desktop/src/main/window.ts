import path from "path";
import type { BrowserWindow as BW } from "electron";
import { BrowserWindow, app, nativeImage } from "electron";
import fs from "fs";

export function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, "..", "..", "build", "icon.png"),
    path.join(__dirname, "..", "..", "renderer", "assets", "icon.png"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return null;
}

export function applyAppIcon(win: BW | null): void {
  const icon = resolveAppIcon();
  if (!icon) return;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }
  if (win && process.platform !== "darwin") {
    win.setIcon(icon);
  }
}

export function createMainWindow(): BW {
  const icon = resolveAppIcon();
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 480,
    minHeight: 520,
    title: "Exitly",
    backgroundColor: "#030806",
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyAppIcon(win);
  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  return win;
}
