import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RESEND_RECIPIENT_ACTION,
  resendRecipientAction,
  resendSuppressionReason,
  resendSuppressionSource,
} from "../src/lib/resendWebhookEventState.ts";

describe("Resend recipient failure classification", () => {
  it("does not turn provider or configuration failures into recipient suppressions", () => {
    assert.equal(
      resendRecipientAction("email.failed"),
      RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE,
    );
  });

  it("keeps temporary delivery delays retryable", () => {
    assert.equal(
      resendRecipientAction("email.delivery_delayed"),
      RESEND_RECIPIENT_ACTION.OBSERVE_DELIVERY_DELAY,
    );
  });

  it("suppresses only permanent bounce outcomes", () => {
    assert.equal(
      resendRecipientAction("email.bounced", "Permanent"),
      RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE,
    );
    assert.equal(
      resendRecipientAction("email.bounced", "Transient"),
      RESEND_RECIPIENT_ACTION.OBSERVE_DELIVERY_DELAY,
    );
    assert.equal(
      resendRecipientAction("email.bounced", "Undetermined"),
      RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE,
    );
    assert.equal(
      resendRecipientAction("email.bounced"),
      RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE,
    );
  });

  it("keeps complaints distinct from provider-suppressed delivery", () => {
    const complaintAction = resendRecipientAction("email.complained");
    const providerSuppressedAction = resendRecipientAction("email.suppressed");
    assert.equal(
      complaintAction,
      RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT,
    );
    assert.equal(
      providerSuppressedAction,
      RESEND_RECIPIENT_ACTION.SUPPRESS_PROVIDER,
    );
    assert.equal(resendSuppressionReason(complaintAction), "COMPLAINT");
    assert.equal(resendSuppressionReason(providerSuppressedAction), "BOUNCE");
    assert.equal(resendSuppressionSource(complaintAction), "resend");
    assert.equal(
      resendSuppressionSource(providerSuppressedAction),
      "resend_provider_suppressed",
    );
    assert.equal(
      resendSuppressionReason(RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE),
      null,
    );
    assert.equal(
      resendSuppressionSource(RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE),
      null,
    );
  });

  it("ignores successful and unrelated lifecycle events", () => {
    for (const type of [
      "email.sent",
      "email.delivered",
      "email.opened",
      "email.clicked",
      "contact.updated",
      "unknown",
    ]) {
      assert.equal(resendRecipientAction(type), RESEND_RECIPIENT_ACTION.IGNORE);
    }
  });
});
