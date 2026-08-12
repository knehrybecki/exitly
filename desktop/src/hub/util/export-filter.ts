const PROJECT_EXPORT_SKIP_DIRS = new Set([
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".crawl4ai",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".idea",
  ".vscode",
]);

const PROJECT_EXPORT_SKIP_FILES = new Set([".DS_Store", "Thumbs.db"]);

export function shouldSkipExportEntry(
  name: string,
  isDirectory: boolean,
): boolean {
  if (!name) return true;
  if (PROJECT_EXPORT_SKIP_FILES.has(name)) return true;
  if (isDirectory && PROJECT_EXPORT_SKIP_DIRS.has(name)) return true;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return true;
  if (name.endsWith(".log")) return true;
  return false;
}

export { PROJECT_EXPORT_SKIP_DIRS, PROJECT_EXPORT_SKIP_FILES };
