/** @ts-nocheck */
import { escapeHtml } from "../ui";

export function slugifyFolderName(name) {
  return (
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project"
  );
}

export function parentDirOf(filePath) {
  const s = String(filePath || "").replace(/[/\\]+$/, "");
  const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return idx > 0 ? s.slice(0, idx) : s;
}
