import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadSubject() {
  const tx = { marker: "transaction-client" };
  const events = [];
  const result = {
    caseId: "case-1",
    orderId: "order-1",
    claimId: "claim-1",
    resolutionMessageId: "message-1",
    resolution: "REFUND_FULL",
    refundAmountCents: 4200,
    currency: "usd",
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
  };
  const dependencies = {
    "@/lib/db": {
      prisma: {
        $transaction: async (run) => {
          events.push("transaction:start");
          const value = await run(tx);
          events.push("transaction:commit");
          return value;
        },
      },
    },
    "@/lib/email": {
      renderCaseResolvedEmail: ({ buyer }) => ({ to: buyer.email, subject: "Buyer", html: "buyer" }),
      renderCaseUpdateEmail: ({ to }) => ({ to, subject: "Seller", html: "seller" }),
    },
    "@/lib/emailOutbox": {
      enqueueEmailOutboxOnce: async (email, client) => {
        assert.equal(client, tx);
        events.push(`enqueue:${email.userId}`);
        return { job: { id: `job-${email.userId}` }, created: true };
      },
      processEmailOutboxJobById: async (id) => events.push(`process:${id}`),
    },
    "@/lib/caseStaffResolutionAuthority": {
      finalizeCaseStaffResolution: async (_actor, _prepared, client) => {
        assert.equal(client, tx);
        events.push("finalize");
        return result;
      },
    },
    "@/lib/caseResolutionCopy": {
      caseResolutionCopy: () => ({ notificationTitle: "Resolved", body: "Refunded" }),
      caseResolutionSellerMessage: () => "The buyer was refunded.",
    },
    "@/lib/notifications": {
      createNotificationOrThrow: async (_notification, client) => {
        assert.equal(client, tx);
        events.push("notification");
      },
    },
    "@/lib/notificationSources": { NOTIFICATION_SOURCE_TYPES: { CASE: "CASE", CASE_MESSAGE: "CASE_MESSAGE" } },
    "@/lib/userEmailDeliveryAccess": {
      userEmailDeliveryRecipient: async (client, { userId }) => {
        assert.equal(client, tx);
        return { email: `${userId}@example.com`, name: userId };
      },
    },
  };
  const javascript = ts.transpileModule(
    readFileSync("src/lib/caseStaffResolutionFinalization.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require: (name) => dependencies[name],
  }, { filename: "src/lib/caseStaffResolutionFinalization.ts" });
  return { subject: exports.finalizeCaseStaffResolutionWithSideEffects, events };
}

test("buyer and maker decision emails are durable before the refund transaction commits", async () => {
  const { subject, events } = loadSubject();
  await subject("staff-1", {});

  const commit = events.indexOf("transaction:commit");
  assert.ok(events.indexOf("enqueue:buyer-1") < commit);
  assert.ok(events.indexOf("enqueue:seller-1") < commit);
  assert.ok(events.indexOf("process:job-buyer-1") > commit);
  assert.ok(events.indexOf("process:job-seller-1") > commit);
});
