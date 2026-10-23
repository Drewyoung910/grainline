import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EmailSuppressionReason } from "@prisma/client";

import { storeProviderSuppressionWithoutWeakeningDirectEvidence } from "../src/lib/emailSuppressionWriteState.ts";
import {
  preserveDirectResendSuppression,
  requireResendRecipientTasks,
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

  it("preserves direct complaint and permanent-bounce provenance from later provider suppression", async () => {
    for (const reason of [EmailSuppressionReason.COMPLAINT, EmailSuppressionReason.BOUNCE]) {
      const direct = {
        email: `${reason.toLowerCase()}@example.test`,
        reason,
        source: "resend",
        eventId: `evt_${reason.toLowerCase()}`,
        details: { direct: true },
      };
      let updateCalls = 0;
      const stored = await storeProviderSuppressionWithoutWeakeningDirectEvidence({
        updateMany: async (args) => {
          updateCalls += 1;
          assert.equal(args.where.email, direct.email);
          assert.deepEqual(args.where.OR, [
            { source: null },
            { source: { not: "resend" } },
            { reason: { notIn: [EmailSuppressionReason.BOUNCE, EmailSuppressionReason.COMPLAINT] } },
          ]);
          return { count: 0 };
        },
        findUnique: async () => direct,
        create: async () => assert.fail("provider suppression must not replace direct evidence"),
      }, {
        email: direct.email,
        reason: EmailSuppressionReason.BOUNCE,
        source: "resend_provider_suppressed",
        eventId: "evt_generic_provider_suppression",
        details: { direct: false },
      });
      assert.equal(updateCalls, 1);
      assert.deepEqual(stored, direct);
    }
    assert.equal(
      preserveDirectResendSuppression(
        { reason: "MANUAL", source: "one_click_unsubscribe" },
        { reason: "BOUNCE", source: "resend_provider_suppressed" },
      ),
      false,
    );
    assert.equal(
      preserveDirectResendSuppression(
        { reason: "BOUNCE", source: "resend_provider_suppressed" },
        { reason: "COMPLAINT", source: "resend" },
      ),
      false,
    );
  });

  it("settles every recipient and allows an idempotent replay after a partial failure", async () => {
    const applied = new Set();
    const attempts = [0, 0];
    const failures = [];
    const tasks = (failSecond) => [0, 1].map(async (recipientIndex) => {
      attempts[recipientIndex] += 1;
      if (recipientIndex === 1 && failSecond) throw new Error("temporary failure");
      applied.add(recipientIndex);
      return recipientIndex;
    });

    await assert.rejects(
      requireResendRecipientTasks(
        tasks(true),
        "resend_webhook_suppress_email",
        (reason, recipientIndex) => failures.push({ reason, recipientIndex }),
      ),
      /failed for 1 recipient/u,
    );
    assert.deepEqual([...applied], [0]);
    assert.deepEqual(failures.map(({ recipientIndex }) => recipientIndex), [1]);

    assert.deepEqual(
      await requireResendRecipientTasks(
        tasks(false),
        "resend_webhook_suppress_email",
      ),
      [0, 1],
    );
    assert.deepEqual([...applied], [0, 1]);
    assert.deepEqual(attempts, [2, 2]);
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
