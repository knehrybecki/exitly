import type { StartOption, StartOptionApply, StartOptionType } from "../../shared/types";

const START_OPTION_TYPES = new Set<StartOptionType>([
  "text",
  "number",
  "checkbox",
  "select",
]);

export function slugOptionId(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function normalizeStartOptions(list: unknown): StartOption[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: StartOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id =
      slugOptionId(row.id || row.key || row.name || row.label) ||
      `opt_${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const type = START_OPTION_TYPES.has(row.type as StartOptionType)
      ? (row.type as StartOptionType)
      : "text";
    const apply: StartOptionApply =
      row.apply === "arg" || row.apply === "both" ? row.apply : "env";
    const opt: StartOption = {
      id,
      label:
        String(row.label || id)
          .trim()
          .slice(0, 80) || id,
      type,
      default:
        row.default == null
          ? type === "checkbox"
            ? "0"
            : ""
          : String(row.default),
      required: !!row.required,
      apply,
      env: String(row.env || `EXITLY_OPT_${id.toUpperCase()}`)
        .trim()
        .replace(/[^A-Za-z0-9_]/g, "")
        .slice(0, 60),
      arg: String(row.arg || "")
        .trim()
        .slice(0, 80),
      placeholder: String(row.placeholder || "").slice(0, 120),
      choices: Array.isArray(row.choices)
        ? row.choices
            .map((c) => String(c).slice(0, 80))
            .filter(Boolean)
            .slice(0, 30)
        : [],
    };
    if (!opt.env) opt.env = `EXITLY_OPT_${id.toUpperCase()}`;
    out.push(opt);
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeOptionValues(
  values: unknown,
  options: unknown,
): Record<string, string> {
  const opts = normalizeStartOptions(options);
  const src =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const opt of opts) {
    if (Object.prototype.hasOwnProperty.call(src, opt.id)) {
      out[opt.id] = String(src[opt.id] ?? "");
    } else {
      out[opt.id] = String(opt.default ?? "");
    }
  }
  return out;
}

export function applyStartOptions(
  options: unknown,
  values: unknown,
): {
  env: Record<string, string>;
  args: string[];
  values: Record<string, string>;
  missing: string[];
} {
  const opts = normalizeStartOptions(options);
  const vals = normalizeOptionValues(values, opts);
  const env: Record<string, string> = {};
  const args: string[] = [];
  const missing: string[] = [];
  for (const opt of opts) {
    let raw = vals[opt.id];
    if (opt.type === "checkbox") {
      const on = /^(1|true|yes|on)$/i.test(String(raw).trim());
      raw = on ? "1" : "0";
      vals[opt.id] = raw;
      if (opt.apply === "env" || opt.apply === "both") {
        env[opt.env] = raw;
      }
      if ((opt.apply === "arg" || opt.apply === "both") && on && opt.arg) {
        args.push(opt.arg);
      }
      continue;
    }
    const text = String(raw ?? "").trim();
    if (opt.required && !text) missing.push(opt.id);
    if (opt.apply === "env" || opt.apply === "both") {
      env[opt.env] = text;
    }
    if ((opt.apply === "arg" || opt.apply === "both") && text) {
      if (opt.arg) {
        args.push(opt.arg, text);
      } else {
        args.push(text);
      }
    }
  }
  return { env, args, values: vals, missing };
}
