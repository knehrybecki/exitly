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
