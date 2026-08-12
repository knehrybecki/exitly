import { describe, expect, it } from "vitest";
import {
  normalizeStartOptions,
  normalizeOptionValues,
  applyStartOptions,
} from "../src/hub/util/options";
import { parseCommand } from "../src/hub/util/command";
import { shouldSkipExportEntry } from "../src/hub/util/export-filter";

describe("parseCommand", () => {
  it("splits quoted args", () => {
    expect(parseCommand(`opencode run "hello world"`)).toEqual([
      "opencode",
      "run",
      "hello world",
    ]);
  });
});

describe("start options", () => {
  it("normalizes and applies env + args", () => {
    const options = normalizeStartOptions([
      { id: "brand", label: "Brand", type: "text", apply: "both", arg: "--brand", env: "BRAND" },
      { id: "dry", label: "Dry", type: "checkbox", apply: "arg", arg: "--dry-run" },
    ]);
    expect(options).toHaveLength(2);
    const applied = applyStartOptions(options, { brand: "Acme", dry: "1" });
    expect(applied.env.BRAND).toBe("Acme");
    expect(applied.args).toEqual(["--brand", "Acme", "--dry-run"]);
  });

  it("fills defaults via normalizeOptionValues", () => {
    const options = normalizeStartOptions([
      { id: "x", default: "1", type: "text" },
    ]);
    expect(normalizeOptionValues({}, options)).toEqual({ x: "1" });
  });
});

describe("shouldSkipExportEntry", () => {
  it("skips venv and logs", () => {
    expect(shouldSkipExportEntry("node_modules", true)).toBe(true);
    expect(shouldSkipExportEntry("app.log", false)).toBe(true);
    expect(shouldSkipExportEntry("main.py", false)).toBe(false);
  });
});
