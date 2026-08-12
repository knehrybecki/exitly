import fs from "fs";
import os from "os";
import path from "path";

export function parseCommand(cmd: string): string[] {
  const text = String(cmd || "").trim();
  if (!text) return [];
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function powershellQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function normalizeCliArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((a) => String(a))
      .filter(Boolean)
      .slice(0, 40);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim().split(/\s+/).filter(Boolean).slice(0, 40);
  }
  return [];
}

/** Dirs Electron GUI apps often miss (OrbStack / Homebrew / Docker Desktop). */
export function hostToolPathDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
  const winProgramFiles = process.env.ProgramFiles || "C:\\Program Files";
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".orbstack", "bin"),
    path.join(home, ".docker", "bin"),
    path.join(home, ".nvm", "current", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/Applications/OrbStack.app/Contents/MacOS/xbin",
    "/Applications/Docker.app/Contents/Resources/bin",
    path.join(winProgramFiles, "Docker", "Docker", "resources", "bin"),
    ...(String(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)),
  ];
}

export function augmentedPath(): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const dir of hostToolPathDirs()) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    parts.push(dir);
  }
  return parts.join(path.delimiter);
}

/** Resolve bare commands (docker, opencode) when Electron PATH is stripped. */
export function resolveHostExecutable(command: string): string {
  const name = String(command || "").trim();
  if (!name) return "";
  if (name.includes("/") || name.includes("\\")) {
    try {
      if (fs.existsSync(name) && fs.statSync(name).isFile()) return name;
    } catch {
      /* ignore */
    }
    return name;
  }
  const exts =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const seen = new Set<string>();
  for (const dir of hostToolPathDirs()) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return "";
}
