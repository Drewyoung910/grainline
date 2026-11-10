import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/lib/firstListingEmail.ts";

function fixture({ publishedCount = 1, recipient = { email: "m@example.com" }, enqueueFails = false } = {}) {
  const state = { enqueued: [], sentry: [], counted: null };
  const dependencies = {
    "@sentry/nextjs": { captureException: (error) => state.sentry.push(error) },
    "@/lib/db": {
      prisma: {
        listing: {
          count: async ({ where }) => {
            state.counted = where;
            return publishedCount;
          },
        },
      },
    },
    "@/lib/email": { renderFirstListingCongratsEmail: () => ({ to: "m@example.com", subject: "s", html: "h" }) },
    "@/lib/emailOutbox": {
      enqueueEmailOutbox: async (job) => {
        if (enqueueFails) throw new Error("down");
        state.enqueued.push(job);
      },
    },
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipient: async () => recipient },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, { exports, require: (name) => dependencies[name] }, { filename: path });
  const send = () => exports.sendFirstListingCongratsIfFirst({
    sellerProfileId: "seller",
    sellerUserId: "user",
    sellerDisplayName: "Shop",
    listing: { id: "listing", title: "Bench", priceCents: 100, currency: "usd" },
  });
  return { state, send };
}

test("the first live listing gets the email with a per-seller key", async () => {
  const subject = fixture();
  await subject.send();
  assert.equal(subject.state.enqueued[0].dedupKey, "first-listing-congrats:seller");
  assert.equal(subject.state.counted.isPrivate, false);
  assert.deepEqual(Array.from(subject.state.counted.status.in), ["ACTIVE", "SOLD", "SOLD_OUT", "HIDDEN"]);
});

test("a later listing does not send the first-listing email", async () => {
  const subject = fixture({ publishedCount: 2 });
  await subject.send();
  assert.equal(subject.state.enqueued.length, 0);
});

test("an email failure never blocks publication", async () => {
  const subject = fixture({ enqueueFails: true });
  await subject.send();
  assert.equal(subject.state.sentry.length, 1);
});
