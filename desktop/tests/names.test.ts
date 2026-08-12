import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  slugifyName,
  sanitizeContainerName,
  containerNamesForSlug,
  uniqueProjectDir,
  resolveTargetProjectDir,
} from "../src/hub/util/names";

describe("slugifyName", () => {
  it("normalizes spaces and case", () => {
    expect(slugifyName("Foo Bar")).toBe("foo-bar");
  });
  it("falls back for empty", () => {
    expect(slugifyName("")).toBe("project");
  });
});

describe("sanitizeContainerName", () => {
  it("prefixes exitly-crawler", () => {
    expect(sanitizeContainerName("Ab C!")).toBe("exitly-crawler-abc");
  });
});

describe("containerNamesForSlug", () => {
  it("uses folder slug not display name", () => {
    const names = containerNamesForSlug("sklep-ro-kopia", "cXXXX1234");
    expect(names.vpnContainerName).toBe("exitly-vpn-sklep-ro-kopia-1234");
    expect(names.containerName).toBe("exitly-proj-sklep-ro-kopia-1234");
  });
});

describe("uniqueProjectDir", () => {
  it("avoids collisions", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "exitly-"));
    fs.mkdirSync(path.join(parent, "demo"));
    const next = uniqueProjectDir(parent, "demo");
    expect(path.basename(next)).toBe("demo-2");
  });
});

describe("resolveTargetProjectDir", () => {
  it("derives folder from name when folder omitted", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "exitly-"));
    const out = resolveTargetProjectDir({
      name: "Sklep RO",
      parentDir: parent,
    });
    expect(out.cleanName).toBe("Sklep RO");
    expect(out.folder).toBe("sklep-ro");
    expect(out.projectDir).toBe(path.join(parent, "sklep-ro"));
  });

  it("keeps custom folder slug separate from display name", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "exitly-"));
    const out = resolveTargetProjectDir({
      name: "Display Name",
      folderName: "custom-folder",
      parentDir: parent,
    });
    expect(out.cleanName).toBe("Display Name");
    expect(out.folder).toBe("custom-folder");
  });

  it("rejects blank folderName when provided empty", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "exitly-"));
    expect(() =>
      resolveTargetProjectDir({
        name: "X",
        folderName: "   ",
        parentDir: parent,
      }),
    ).toThrow(/folderu/i);
  });
});
