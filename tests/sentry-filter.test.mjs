import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { beforeBreadcrumb, beforeSend } = await import("../src/lib/sentryFilter.ts");

describe("Sentry beforeSend filtering", () => {
  it("drops common browser and network noise before upload", () => {
    assert.equal(beforeSend({ message: "ResizeObserver loop completed with undelivered notifications." }), null);
    assert.equal(beforeSend({ exception: { values: [{ value: "ChunkLoadError: Loading chunk 7 failed" }] } }), null);
  });

  it("redacts sensitive headers, cookies, query params, and user PII", () => {
    const event = beforeSend({
      request: {
        headers: {
          authorization: "Bearer secret",
          cookie: "session=abc",
          "x-trace-id": "trace-123",
        },
        cookies: { session: "abc" },
        query_string: "token=secret-token&safe=value",
        url: "https://thegrainline.com/unsubscribe?signature=abc&email=buyer@example.com",
      },
      user: {
        id: "user_123",
        email: "buyer@example.com",
        ip_address: "127.0.0.1",
      },
    });

    assert.deepEqual(event.request.headers, {
      authorization: "[redacted]",
      cookie: "[redacted]",
      "x-trace-id": "trace-123",
    });
    assert.deepEqual(event.request.cookies, {});
    assert.equal(event.request.query_string, "token=[redacted]&safe=value");
    assert.equal(
      event.request.url,
      "https://thegrainline.com/unsubscribe?signature=[redacted]&email=[redacted-email]",
    );
    assert.deepEqual(event.user, { id: "user_123" });
  });

  it("redacts nested extra/context/tag payloads", () => {
    const event = beforeSend({
      extra: {
        email: "seller@example.com",
        nested: { stripeSecret: "sk_test_123", note: "Contact buyer@example.com" },
      },
      contexts: {
        app: { token: "secret", visible: "ok" },
      },
      tags: {
        path: "/dashboard",
        session: "abc",
      },
    });

    assert.deepEqual(event.extra, {
      email: "[redacted]",
      nested: { stripeSecret: "[redacted]", note: "Contact [redacted-email]" },
    });
    assert.deepEqual(event.contexts, {
      app: { token: "[redacted]", visible: "ok" },
    });
    assert.deepEqual(event.tags, {
      path: "/dashboard",
      session: "[redacted]",
    });
  });

  it("redacts URLs and sensitive breadcrumb data before upload", () => {
    const breadcrumb = beforeBreadcrumb({
      category: "fetch",
      message: "POST /api/account/export?token=secret",
      data: {
        url: "https://thegrainline.com/checkout/success?session_id=cs_test_123&safe=1",
        requestHeaders: { cookie: "session=abc", "x-trace-id": "trace-123" },
      },
    });

    assert.equal(breadcrumb.message, "POST /api/account/export?token=[redacted]");
    assert.equal(
      breadcrumb.data.url,
      "https://thegrainline.com/checkout/success?session_id=[redacted]&safe=1",
    );
    assert.deepEqual(breadcrumb.data.requestHeaders, {
      cookie: "[redacted]",
      "x-trace-id": "trace-123",
    });
  });
});
