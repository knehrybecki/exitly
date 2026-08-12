import fs from "fs";
import path from "path";

export function slugifyName(name: string): string {
  return (
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project"
  );
}

export function sanitizeContainerName(id: string): string {
  const slug = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  return `exitly-crawler-${slug || "x"}`;
}

/** Dedicated Docker names for a project — always derived from folder slug. */
export function containerNamesForSlug(
  folderSlug: string,
  id: string,
): { vpnContainerName: string; containerName: string } {
  const slug = slugifyName(folderSlug);
  const suffix = String(id || "xxxx").slice(-4);
  return {
    vpnContainerName: `exitly-vpn-${slug}-${suffix}`,
    containerName: `exitly-proj-${slug}-${suffix}`,
  };
}

export function uniqueProjectDir(parent: string, preferredName: string): string {
  const base = slugifyName(preferredName);
  let dir = path.join(parent, base);
  if (!fs.existsSync(dir)) return dir;
  for (let i = 2; i < 1000; i += 1) {
    dir = path.join(parent, `${base}-${i}`);
    if (!fs.existsSync(dir)) return dir;
  }
  throw new Error("Nie udało się znaleźć wolnej nazwy folderu");
}

export interface TargetProjectDirInput {
  name: string;
  folderName?: string;
  parentDir?: string;
  sourcePath?: string;
}

/** Resolve display name + destination folder for create/duplicate. */
export function resolveTargetProjectDir(input: TargetProjectDirInput): {
  cleanName: string;
  folder: string;
  parent: string;
  projectDir: string;
} {
  const cleanName = String(input.name || "")
    .trim()
    .slice(0, 60);
  if (!cleanName) throw new Error("Podaj nazwę projektu");

  const folderRaw = String(input.folderName || "").trim();
  if (input.folderName != null && input.folderName !== "" && !folderRaw) {
    throw new Error("Podaj nazwę folderu");
  }
  const folder = slugifyName(folderRaw || cleanName);

  const parent = path.resolve(
    String(input.parentDir || "").trim() ||
      (input.sourcePath ? path.dirname(path.resolve(input.sourcePath)) : ""),
  );
  if (!parent || !fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("Wybierz istniejący folder nadrzędny");
  }

  const projectDir = path.join(parent, folder);
  return { cleanName, folder, parent, projectDir };
}

export function newCrawlerId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
