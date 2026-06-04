import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  normalizeSupportRequest,
  SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
  supportRequestEmailNotificationState,
  supportRequestAccountExportWhere,
  supportRequestSlaDueAt,
  normalizeSupportRequestClosureEvidence,
  SUPPORT_REQUEST_CLOSURE_EVIDENCE_MAX_CHARS,
} = await import("../src/lib/supportRequest.ts");

const source = readFileSync(new URL("../src/lib/supportRequest.ts", import.meta.url), "utf8");

function projectFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("support request helpers", () => {
  it("normalizes support requests before email delivery", () => {
    assert.match(source, /function normalizeEmailAddress/);
    assert.match(source, /normalizeUserText\(email \?\? ""\)\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(source, /SUPPORT_EMAIL_PATTERN\.test\(normalized\)/);
    assert.match(source, /name: cleanOptionalText\(input\.name, 100\)/);
    assert.match(source, /orderId: cleanOptionalText\(input\.orderId, 80\)/);
    assert.match(source, /listingId: cleanOptionalText\(input\.listingId, 80\)/);
    assert.match(source, /supportRequestStorageKind/);
  });

  it("keeps order and listing references as separate bounded fields", () => {
    const normalized = normalizeSupportRequest("support", {
      email: "Buyer@Example.com",
      topic: "order",
      orderId: "order_123",
      listingId: "listing_456",
      message: "<script>alert(1)</script>I need help with an order.",
    });

    assert.equal(normalized.ok, true);
    if (normalized.ok) {
      assert.equal(normalized.request.email, "buyer@example.com");
      assert.equal(normalized.request.orderId, "order_123");
      assert.equal(normalized.request.listingId, "listing_456");
      assert.equal(normalized.request.message, "I need help with an order.");
    }
  });

  it("rejects invalid or empty requests", () => {
    assert.match(source, /const SUPPORT_EMAIL_PATTERN = \/\^\[A-Z0-9\._%\+-\]\+\@\[A-Z0-9\.-\]\+\\\.\[A-Z\]\{2,\}\$\/i/);
    assert.match(source, /EMAIL_CONTROL_CHARS\.test\(normalized\)/);
    assert.match(source, /!SUPPORT_EMAIL_PATTERN\.test\(normalized\)/);
    assert.match(source, /message\.length < 10/);
    assert.match(source, /Enter a valid email address/);
    assert.match(source, /Add a few details so we can help/);
  });

  it("rejects support email addresses containing control characters", () => {
    const normalized = normalizeSupportRequest("support", {
      email: "buyer@example.com\nbcc:attacker@example.com",
      message: "I need help with an order.",
    });

    assert.deepEqual(normalized, { ok: false, error: "Enter a valid email address." });
  });

  it("routes data requests to legal and escapes email HTML", () => {
    assert.match(source, /supportRequestRecipient/);
    assert.match(source, /legal@thegrainline\.com/);
    assert.match(source, /supportRequestSubject/);
    assert.match(source, /"Data request"/);
    assert.match(source, /supportRequestHtml/);
    assert.match(source, /esc\(request\.message\)/);
  });

  it("computes a 45-day SLA due date for verifiable data requests", () => {
    assert.equal(
      supportRequestSlaDueAt(new Date("2026-05-01T00:00:00.000Z")).toISOString(),
      "2026-06-15T00:00:00.000Z",
    );
  });

  it("matches account exports by stable user id with account email history fallback", () => {
    assert.deepEqual(supportRequestAccountExportWhere("user_123", "buyer@example.com"), {
      OR: [{ userId: "user_123" }, { email: { in: ["buyer@example.com"] } }],
    });
    assert.deepEqual(supportRequestAccountExportWhere("user_123", [
      "buyer@example.com",
      "old@example.com",
      "buyer@example.com",
    ]), {
      OR: [{ userId: "user_123" }, { email: { in: ["buyer@example.com", "old@example.com"] } }],
    });
    assert.deepEqual(supportRequestAccountExportWhere("user_123", null), { userId: "user_123" });
  });

  it("distinguishes ambiguous notification delivery state for admins", () => {
    assert.deepEqual(
      supportRequestEmailNotificationState({
        emailSentAt: new Date("2026-05-29T00:00:00.000Z"),
        emailLastError: SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
      }),
      { label: "Sent", tone: "success", message: null },
    );
    assert.deepEqual(
      supportRequestEmailNotificationState({
        emailSentAt: null,
        emailLastError: SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
      }),
      {
        label: "Needs review",
        tone: "warning",
        message: SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
      },
    );
    assert.deepEqual(
      supportRequestEmailNotificationState({ emailSentAt: null, emailLastError: "provider rejected" }),
      { label: "Failed", tone: "error", message: "Email error: provider rejected" },
    );
    assert.deepEqual(
      supportRequestEmailNotificationState({ emailSentAt: null, emailLastError: null }),
      { label: "Pending", tone: "neutral", message: null },
    );
  });

  it("requires bounded sanitized closure evidence for data requests", () => {
    assert.deepEqual(
      normalizeSupportRequestClosureEvidence("too short"),
      { ok: false, error: "Add closure evidence before closing this data request." },
    );

    const normalized = normalizeSupportRequestClosureEvidence(
      "<script>alert(1)</script>Local deletion completed. Resend ticket R-123 closed. Requester response sent by legal owner on 2026-06-04.",
    );
    assert.equal(normalized.ok, true);
    if (normalized.ok) {
      assert.doesNotMatch(normalized.evidence, /<script|alert/);
      assert.match(normalized.evidence, /Resend ticket R-123 closed/);
      assert.ok(normalized.evidence.length <= SUPPORT_REQUEST_CLOSURE_EVIDENCE_MAX_CHARS);
    }
  });

  it("documents provider-side privacy request handling for processors", () => {
    const runbook = projectFile("docs/runbook.md");

    assert.match(runbook, /Processor-side privacy requests/);
    assert.match(runbook, /SupportRequest` open or `IN_PROGRESS/);
    assert.match(runbook, /hashed email/);
    assert.match(runbook, /Resend: check sent-message, bounce, complaint, suppression, and webhook event records/);
    assert.match(runbook, /provider ticket id, date, owner, and outcome/);
    assert.match(runbook, /Do not assume `EmailOutbox` or `ResendWebhookEvent` pruning deletes provider copies/);
    assert.match(runbook, /Stripe, Clerk, Shippo, Sentry, Cloudflare, Neon, Upstash, and Vercel/);
  });
});
