import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/lib/caseStaffResolutionFinalization.ts";

function fixture({ resolution, description, reason = "OTHER" }) {
  const sent = { notifications: [], emails: [] };
  const result = {
    claimId: "claim", caseId: "case", orderId: "order", buyerUserId: "buyer", sellerUserId: "seller",
    resolution, refundAmountCents: resolution === "DISMISSED" ? null : 1000, currency: "usd",
    resolutionMessageId: "msg",
  };
  const dependencies = {
    "@/lib/db": { prisma: { $transaction: (fn) => fn({}) } },
    "@/lib/email": { renderCaseResolvedEmail: () => ({ to: "b@example.test", subject: "s", html: "h" }) },
    "@/lib/emailOutbox": {
      enqueueEmailOutboxOnce: async (job) => { sent.emails.push(job.userId); return { job: { id: "job" } }; },
      processEmailOutboxJobById: async () => undefined,
    },
    "@/lib/caseStaffResolutionAuthority": { finalizeCaseStaffResolution: async () => result },
    "@/lib/caseResolutionCopy": {
      caseResolutionCopy: () => ({ notificationTitle: "t", body: "b" }),
      caseResolutionSellerMessage: () => "m",
    },
    "@/lib/notifications": {
      createNotificationOrThrow: async (input) => { sent.notifications.push(input.userId); },
    },
    "@/lib/notificationSources": { NOTIFICATION_SOURCE_TYPES: { CASE: "case", CASE_MESSAGE: "case_message" } },
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipient: async () => ({ email: "b@example.test" }) },
    "@/lib/caseReadAuthority": {
      getVisibleCaseById: async () => ({ id: "case", reason, description }),
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, console,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`unexpected import ${name}`);
      return dependencies[name];
    },
  }, { filename: path });
  return {
    sent,
    run: () => exports.finalizeCaseStaffResolutionWithSideEffects("staff", { resolution, caseId: "case" }),
  };
}

const chargeback = "Stripe payment dispute dp_123: product_not_received";

test("dismissing a Case a chargeback opened sends the buyer nothing", async () => {
  const subject = fixture({ resolution: "DISMISSED", description: chargeback });
  await subject.run();
  assert.deepEqual(subject.sent.notifications, ["seller"]);
  assert.deepEqual(subject.sent.emails, []);
});

test("dismissing a Case the buyer opened still tells the buyer", async () => {
  const subject = fixture({ resolution: "DISMISSED", description: "The chair arrived broken", reason: "DAMAGED" });
  await subject.run();
  assert.deepEqual(subject.sent.notifications, ["buyer", "seller"]);
  assert.deepEqual(subject.sent.emails, ["buyer"]);
});

test("a refund on a chargeback Case still tells the buyer about the money", async () => {
  const subject = fixture({ resolution: "REFUND_FULL", description: chargeback });
  await subject.run();
  assert.deepEqual(subject.sent.notifications, ["buyer", "seller"]);
  assert.deepEqual(subject.sent.emails, ["buyer"]);
});
