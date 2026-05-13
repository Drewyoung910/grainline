import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  cspReportDirective,
  cspReportDocumentPath,
  cspReportSentryTags,
  isCheckoutCspReport,
  sanitizeCspReportForSentry,
} = await import("../src/lib/cspReport.ts");

describe("CSP report sanitization", () => {
  it("tags checkout-page script and frame violations explicitly", () => {
    const report = {
      "effective-directive": "script-src-elem",
      "document-uri": "https://thegrainline.com/checkout/success?session_id=cs_test_secret",
      "blocked-uri": "https://evil.example/skimmer.js?token=secret",
    };

    assert.equal(cspReportDirective(report), "script-src-elem");
    assert.equal(cspReportDocumentPath(report), "/checkout/success");
    assert.equal(isCheckoutCspReport(report), true);
    assert.deepEqual(cspReportSentryTags(report), {
      source: "csp_report",
      event_kind: "security_policy",
      csp_violation: "script-src-elem",
      blocked_uri: "https://evil.example",
      document_path: "/checkout/success",
      checkout_surface: "true",
    });
  });

  it("does not send checkout query strings or external paths to Sentry", () => {
    const report = {
      "violated-directive": "frame-src",
      "document-uri": "https://thegrainline.com/cart?checkout=cs_test_secret",
      referrer: "https://thegrainline.com/cart?checkout=cs_test_secret",
      "blocked-uri": "https://evil.example/path/to/skimmer.js?token=secret",
      "source-file": "https://evil.example/long/path.js?token=secret",
    };
    const sanitized = sanitizeCspReportForSentry(report);

    assert.equal(sanitized["document-uri"], "https://thegrainline.com/cart");
    assert.equal(sanitized.referrer, "https://thegrainline.com/cart");
    assert.equal(sanitized["blocked-uri"], "https://evil.example");
    assert.equal(sanitized["source-file"], "https://evil.example");
    assert.doesNotMatch(JSON.stringify(sanitized), /cs_test_secret|token=secret/);
  });

  it("keeps non-checkout documents distinguishable", () => {
    const report = {
      "effective-directive": "img-src",
      "document-uri": "https://thegrainline.com/blog/example-post",
      "blocked-uri": "inline",
    };

    assert.equal(isCheckoutCspReport(report), false);
    assert.equal(cspReportSentryTags(report).checkout_surface, "false");
    assert.equal(cspReportSentryTags(report).document_path, "/blog/example-post");
  });
});
