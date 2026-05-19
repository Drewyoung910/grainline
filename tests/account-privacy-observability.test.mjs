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
    assert.match(route, /safeRateLimit\(newsletterRatelimit, ip\)/);
    assert.doesNotMatch(route, /safeRateLimitOpen\(newsletterRatelimit/);
    assert.match(route, /readBoundedJson\(req, NEWSLETTER_BODY_MAX_BYTES\)/);
    assert.match(route, /parsed\.email\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(route, /isRequestBodyTooLargeError/);
    assert.match(route, /rateLimitResponse\(rl\.reset, "Too many newsletter signup attempts\."\)/);
    assert.match(route, /hashEmailForTelemetry\(email\)/);
    assert.match(route, /source: "newsletter_subscribe"/);
    assert.match(route, /extra: \{ emailHash \}/);
    assert.match(route, /isEmailSuppressed\(email\)/);
    assert.doesNotMatch(route, /suppressed: true/);
    assert.doesNotMatch(route, /subscribed: false/);
  });

  it("bounds public support and privacy request bodies before normalization", () => {
    const support = source("src/app/api/support/route.ts");
    const dataRequest = source("src/app/api/legal/data-request/route.ts");

    for (const route of [support, dataRequest]) {
      assert.match(route, /readBoundedJson\(req, [A-Z_]+_BODY_MAX_BYTES\)/);
      assert.match(route, /isRequestBodyTooLargeError/);
      assert.match(route, /Request body too large/);
      assert.doesNotMatch(route, /body = await req\.json\(\)/);
    }
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
    assert.match(email, /console\.log\("\[email:dev\]", \{ emailHash, subjectLength: sanitizedSubject\.length \}\)/);
    assert.match(email, /console\.error\("\[email\] inactive-account lookup failed; skipping send:", sanitizeEmailOutboxError\(err\)\)/);
    assert.match(email, /source: "email_inactive_account_lookup"/);
    assert.match(email, /source: "email_send_retry"/);
    assert.match(email, /source: "email_send"/);
    assert.doesNotMatch(email, /console\.log\("\[email:dev\]", \{ to: recipient/);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*\bto:\s*recipient/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*\bto,/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*subject:\s*sanitizedSubject/s);
    assert.doesNotMatch(email, /extra:\s*\{[^}]*subject\s*\}/s);
  });

  it("preserves Resend webhook error evidence even when marking the event failed errors", () => {
    const route = source("src/app/api/resend/webhook/route.ts");

    assert.match(route, /markWebhookFailed\(id, err\)\.catch/);
    assert.match(route, /sanitizeEmailOutboxError\(err\)/);
    assert.match(route, /processingStartedAt: null/);
    assert.match(route, /safeResendWebhookDetails\(event, id, emails\)/);
    assert.match(route, /const TRANSIENT_FAILURE_SUPPRESSION_THRESHOLD = 5/);
    assert.match(route, /return type === "email\.failed"/);
    assert.doesNotMatch(route, /email\.delivery_delayed/);
    assert.doesNotMatch(route, /details: event as unknown as Prisma\.InputJsonValue/);
    assert.match(route, /source: "resend_webhook_mark_failed"/);
    assert.match(route, /source: "resend_webhook_process"/);
  });

  it("returns retryable status for in-progress Resend webhook reservations", () => {
    const route = source("src/app/api/resend/webhook/route.ts");

    assert.match(route, /reservation === "processed"/);
    assert.match(route, /reservation === "in_progress"/);
    const inProgressStart = route.indexOf('reservation === "in_progress"');
    const processStart = route.indexOf("try {", inProgressStart);
    const inProgressBlock = route.slice(inProgressStart, processStart);
    assert.match(inProgressBlock, /status: 503/);
    assert.match(inProgressBlock, /"Retry-After": String\(RESEND_WEBHOOK_RETRY_AFTER_SECONDS\)/);
    assert.doesNotMatch(inProgressBlock, /ok: true/);
  });

  it("captures each Resend recipient task failure before retrying the webhook", () => {
    const route = source("src/app/api/resend/webhook/route.ts");

    assert.match(route, /Promise\.allSettled\(tasks\)/);
    assert.match(route, /"resend_webhook_suppress_email"/);
    assert.match(route, /"resend_webhook_transient_failure"/);
    assert.match(route, /recipientIndex: index/);
    assert.doesNotMatch(route, /await Promise\.all\(\s*emails\.map/s);
  });
});
