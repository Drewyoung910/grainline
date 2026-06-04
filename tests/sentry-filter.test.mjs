import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { beforeBreadcrumb, beforeSend } = await import("../src/lib/sentryFilter.ts");

describe("Sentry beforeSend filtering", () => {
  it("drops common browser and network noise before upload", () => {
    assert.equal(beforeSend({ message: "ResizeObserver loop completed with undelivered notifications." }), null);
    assert.equal(beforeSend({ exception: { values: [{ value: "ChunkLoadError: Loading chunk 7 failed" }] } }), null);
  });

  it("drops bot-only Stripe.js load failures without hiding buyer checkout failures", () => {
    assert.equal(
      beforeSend({
        exception: { values: [{ value: "Error: Failed to load Stripe.js" }] },
        tags: { browser: "Googlebot 2.1", "browser.name": "Googlebot", device: "Smartphone" },
      }),
      null,
    );

    const buyerEvent = beforeSend({
      exception: { values: [{ value: "Error: Failed to load Stripe.js" }] },
      tags: { browser: "Mobile Safari 26.0.1", "browser.name": "Mobile Safari" },
    });
    assert.equal(buyerEvent?.exception?.values?.[0]?.value, "Error: Failed to load Stripe.js");
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
        emailHash: "sha256:0123456789abcdef01234567",
        badEmailHash: "seller@example.com",
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
      emailHash: "sha256:0123456789abcdef01234567",
      badEmailHash: "[redacted]",
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

  it("redacts sensitive data from top-level messages, transactions, and exception values", () => {
    const event = beforeSend({
      message: "Failed to email buyer@example.com for /checkout/success?session_id=cs_test_123",
      transaction: "GET /unsubscribe?token=secret-token&email=seller@example.com",
      exception: {
        values: [
          {
            type: "Error",
            value: "Stripe rejected customer buyer@example.com with client_secret=secret_123",
            stacktrace: {
              frames: [
                {
                  filename: "route.ts",
                  vars: {
                    email: "buyer@example.com",
                    safe: "visible",
                  },
                },
              ],
            },
          },
        ],
      },
    });

    assert.equal(
      event.message,
      "Failed to email [redacted-email] for /checkout/success?session_id=[redacted]",
    );
    assert.equal(event.transaction, "GET /unsubscribe?token=[redacted]&email=[redacted-email]");
    assert.equal(
      event.exception.values[0].value,
      "Stripe rejected customer [redacted-email] with client_secret=[redacted]",
    );
    assert.deepEqual(event.exception.values[0].stacktrace.frames[0].vars, {
      email: "[redacted]",
      safe: "visible",
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
