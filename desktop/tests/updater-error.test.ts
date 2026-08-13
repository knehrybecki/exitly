import { describe, expect, it } from "vitest";
import { friendlyUpdateError } from "../src/updater-error";

describe("friendlyUpdateError", () => {
  it("maps GitHub 429 HTML to a short Polish message", () => {
    const html = `Cannot download https://github.com/knehrybecki/exitly/releases/download/v1.0.10/latest-mac.yml
<!DOCTYPE html><html><head><title>Too many requests</title>
<style>body{color:red}</style></head><body>
<p>You have exceeded a secondary rate limit.</p>
<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=">
Please wait a few minutes before you try again.
</body></html>`;
    const msg = friendlyUpdateError(new Error(html));
    expect(msg).toMatch(/429/);
    expect(msg).not.toMatch(/<!DOCTYPE|<html|data:image|secondary rate/i);
    expect(msg.length).toBeLessThan(200);
  });

  it("keeps signature errors readable", () => {
    expect(friendlyUpdateError(new Error("Code signature did not pass validation"))).toMatch(
      /Podpis/,
    );
  });
});
