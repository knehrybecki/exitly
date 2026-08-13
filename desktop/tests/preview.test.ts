import { describe, expect, it } from "vitest";
import { classifyLogLine } from "../src/renderer/projects/preview";

describe("classifyLogLine", () => {
  it("detects crawl traffic", () => {
    expect(classifyLogLine("GET https://example.com/oferta")).toBe("crawl");
    expect(classifyLogLine("crawling product page")).toBe("crawl");
  });

  it("detects vpn and errors", () => {
    expect(classifyLogLine("WireGuard tunnel connected")).toBe("vpn");
    expect(classifyLogLine("Traceback: RuntimeError failed")).toBe("error");
    expect(classifyLogLine("WARN captcha retry")).toBe("warn");
  });
});
