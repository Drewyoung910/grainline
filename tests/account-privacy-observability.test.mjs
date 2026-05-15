import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account and privacy route observability guardrails", () => {
  it("captures account export failures without exporting payload details to Sentry", () => {
    const route = source("src/app/api/account/export/route.ts");

    assert.match(route, /source: "account_export"/);
    assert.match(route, /source: "account_export_audit_log"/);
    assert.match(route, /extra: \{ userId: exportUserId, method \}/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*payload/s);
  });

  it("keeps newsletter signup fail-closed and observable with hashed email telemetry", () => {
    const route = source("src/app/api/newsletter/route.ts");

    assert.match(route, /getIP\(req\)/);
    assert.match(route, /rateLimitResponse\(rl\.reset, "Too many newsletter signup attempts\."\)/);
    assert.match(route, /hashEmailForTelemetry\(email\)/);
    assert.match(route, /source: "newsletter_subscribe"/);
    assert.match(route, /extra: \{ emailHash \}/);
    assert.match(route, /isEmailSuppressed\(email\)/);
  });

  it("captures unsubscribe processing failures with hashed email telemetry only", () => {
    const route = source("src/app/api/email/unsubscribe/route.ts");

    assert.match(route, /source: "unsubscribe_email"/);
    assert.match(route, /hashEmailForTelemetry\(email\)/);
    assert.doesNotMatch(route, /extra: \{ email \}/);
  });

  it("keeps central email failure telemetry off raw recipient emails", () => {
    const email = source("src/lib/email.ts");

    assert.match(email, /hashEmailForTelemetry/);
    assert.match(email, /source: "email_inactive_account_lookup"/);
    assert.match(email, /source: "email_send_retry"/);
    assert.match(email, /source: "email_send"/);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*\bto:\s*recipient/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*\bto,/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*subject:\s*sanitizedSubject/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*subject\s*\}/s);
  });

  it("preserves Resend webhook error evidence even when marking the event failed errors", () => {
    const route = source("src/app/api/resend/webhook/route.ts");

    assert.match(route, /markWebhookFailed\(id, err\)\.catch/);
    assert.match(route, /source: "resend_webhook_mark_failed"/);
    assert.match(route, /source: "resend_webhook_process"/);
  });
});
