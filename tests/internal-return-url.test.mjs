import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { safeInternalReturnUrl } = await import("../src/lib/internalReturnUrl.ts");

describe("safe internal return URLs", () => {
  const appUrl = "https://thegrainline.com";

  it("accepts same-origin relative paths and normalizes them to absolute URLs", () => {
    assert.equal(
      safeInternalReturnUrl("/dashboard/onboarding?step=3#stripe", appUrl),
      "https://thegrainline.com/dashboard/onboarding?step=3#stripe",
    );
  });

  it("rejects protocol-relative and backslash-prefixed redirects", () => {
    assert.equal(safeInternalReturnUrl("//evil.example/path", appUrl), null);
    assert.equal(safeInternalReturnUrl("/\\evil.example/path", appUrl), null);
  });

  it("rejects absolute URLs and non-path values", () => {
    assert.equal(safeInternalReturnUrl("https://evil.example/path", appUrl), null);
    assert.equal(safeInternalReturnUrl("dashboard/onboarding", appUrl), null);
    assert.equal(safeInternalReturnUrl("", appUrl), null);
  });

  it("rejects malformed app origins instead of failing open", () => {
    assert.equal(safeInternalReturnUrl("/dashboard", "not a url"), null);
  });
});
