import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/lib/stripeWebhookMirror.ts";

function fixture({ wasEnabled = true, ownerActive = true, sendFails = false } = {}) {
  const state = { sent: [], sentry: [], updates: 0 };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@sentry/nextjs": { captureException: (error) => state.sentry.push(error) },
    "@/lib/db": { prisma: { $transaction: async (run) => run({}) } },
    "@/lib/sellerStripePrivateAccess": {
      sellerStripeMirrorState: async () => ({
        id: "seller", userId: "user", ownerAccountActive: ownerActive, chargesEnabled: wasEnabled, stripeAccountId: "acct",
      }),
      updateSellerStripeChargesEnabled: async () => {
        state.updates += 1;
      },
    },
    "@/lib/userEmailDeliveryAccess": {
      userEmailDeliveryRecipient: async () => ({ email: "m@example.com", name: "Mara" }),
    },
    "@/lib/email": {
      renderShopPausedEmail: (input) => ({ to: input.to, subject: "Paused", html: "<p>Paused</p>" }),
      sendRenderedEmail: async (email, options) => {
        if (sendFails) throw new Error("down");
        state.sent.push({ email, options });
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, mirror: (chargesEnabled) => exports.mirrorStripeChargesEnabled({ accountId: "acct", chargesEnabled }) };
}

test("the maker is told when Stripe pauses their shop", async () => {
  const subject = fixture();
  await subject.mirror(false);
  assert.equal(subject.state.sent.length, 1);
  // Two webhooks racing on the same change must not send it twice.
  assert.match(subject.state.sent[0].options.idempotencyKey, /^shop-paused:seller:\d{4}-\d{2}-\d{2}$/);
});

test("no second email when nothing changed, or when the account is banned", async () => {
  const unchanged = fixture({ wasEnabled: false });
  await unchanged.mirror(false);
  assert.equal(unchanged.state.sent.length, 0);

  const banned = fixture({ ownerActive: false });
  await banned.mirror(false);
  assert.equal(banned.state.sent.length, 0);
});

test("turning back on sends nothing, and a failed email never fails the webhook", async () => {
  const on = fixture({ wasEnabled: false });
  await on.mirror(true);
  assert.equal(on.state.sent.length, 0);

  const failing = fixture({ sendFails: true });
  await failing.mirror(false);
  assert.equal(failing.state.sentry.length, 1);
  assert.equal(failing.state.updates, 1);
});
