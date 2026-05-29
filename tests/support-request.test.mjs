import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  normalizeSupportRequest,
  SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
  supportRequestEmailNotificationState,
  supportRequestAccountExportWhere,
  supportRequestSlaDueAt,
} = await import("../src/lib/supportRequest.ts");

const source = readFileSync(new URL("../src/lib/supportRequest.ts", import.meta.url), "utf8");

describe("support request helpers", () => {
  it("normalizes support requests before email delivery", () => {
    assert.match(source, /function normalizeEmailAddress/);
    assert.match(source, /normalizeUserText\(email \?\? ""\)\.trim\(\)\.normalize\("NFC"\)\.toLowerCase\(\)/);
    assert.match(source, /SUPPORT_EMAIL_PATTERN\.test\(normalized\)/);
    assert.match(source, /name: cleanOptionalText\(input\.name, 100\)/);
    assert.match(source, /orderId: cleanOptionalText\(input\.orderId, 80\)/);
    assert.match(source, /supportRequestStorageKind/);
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

  it("matches account exports by stable user id with current-email fallback", () => {
    assert.deepEqual(supportRequestAccountExportWhere("user_123", "buyer@example.com"), {
      OR: [{ userId: "user_123" }, { email: "buyer@example.com" }],
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
});
