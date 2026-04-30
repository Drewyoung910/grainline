import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  safeInternalPath,
  safeInternalReturnUrl,
  signInPathForRedirect,
  signUpPathForRedirect,
} = await import("../src/lib/internalReturnUrl.ts");

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

describe("safe internal auth redirect paths", () => {
  it("keeps internal paths as relative Clerk redirect targets", () => {
    assert.equal(
      safeInternalPath("/listing/abc?buy_now=1&variant_options=opt_1,opt_2#purchase"),
      "/listing/abc?buy_now=1&variant_options=opt_1,opt_2#purchase",
    );
  });

  it("uses the first query value and rejects external redirects", () => {
    assert.equal(safeInternalPath(["/cart", "/dashboard"]), "/cart");
    assert.equal(safeInternalPath("https://evil.example/cart", "/fallback"), "/fallback");
    assert.equal(safeInternalPath("//evil.example/cart", "/fallback"), "/fallback");
    assert.equal(safeInternalPath("cart", "/fallback"), "/fallback");
  });

  it("builds sign-in and sign-up paths with sanitized redirect_url values", () => {
    assert.equal(
      signInPathForRedirect("/cart?step=payment"),
      "/sign-in?redirect_url=%2Fcart%3Fstep%3Dpayment",
    );
    assert.equal(
      signUpPathForRedirect("https://evil.example/cart", "/cart"),
      "/sign-up?redirect_url=%2Fcart",
    );
  });
});
