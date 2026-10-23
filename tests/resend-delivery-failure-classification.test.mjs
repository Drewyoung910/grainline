import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RESEND_RECIPIENT_ACTION,
  resendRecipientAction,
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

  it("suppresses permanent bounce and complaint outcomes", () => {
    assert.equal(
      resendRecipientAction("email.bounced"),
      RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE,
    );
    assert.equal(
      resendRecipientAction("email.complained"),
      RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT,
    );
    assert.equal(
      resendRecipientAction("email.suppressed"),
      RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT,
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
