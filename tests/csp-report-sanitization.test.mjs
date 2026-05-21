import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  cspReportBreadcrumbData,
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

  it("does not send raw blocked URLs to Sentry breadcrumbs", () => {
    const report = {
      "effective-directive": "script-src-elem",
      "document-uri": "https://thegrainline.com/messages/convo_123?token=secret",
      "blocked-uri": "https://evil.example/path/to/skimmer.js?token=secret",
    };
    const breadcrumb = cspReportBreadcrumbData(report);

    assert.equal(breadcrumb.blockedUri, "https://evil.example");
    assert.equal(breadcrumb.documentPath, "/messages/[id]");
    assert.equal(breadcrumb.effectiveDirective, "script-src-elem");
    assert.doesNotMatch(JSON.stringify(breadcrumb), /token=secret|skimmer\.js|convo_123/);
  });

  it("redacts dynamic path identifiers from CSP tags and sanitized report extras", () => {
    const report = {
      "effective-directive": "connect-src",
      "document-uri": "https://thegrainline.com/listing/cmp1oo7nt000204jw976udshz--cat-litter-box?client_secret=secret",
      referrer: "https://thegrainline.com/messages/cmp0w0075000404i8pha5p646",
      "blocked-uri": "self",
    };

    assert.equal(cspReportDocumentPath(report), "/listing/[id]");
    assert.equal(cspReportSentryTags(report).document_path, "/listing/[id]");
    const sanitized = sanitizeCspReportForSentry(report);
    assert.equal(sanitized["document-uri"], "https://thegrainline.com/listing/[id]");
    assert.equal(sanitized.referrer, "https://thegrainline.com/messages/[id]");
    assert.doesNotMatch(JSON.stringify({ sanitized, tags: cspReportSentryTags(report) }), /cmp1oo7|cmp0w/);
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
