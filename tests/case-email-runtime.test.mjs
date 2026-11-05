import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);

function loadModule(path, dependencies, sandbox = {}) {
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, URL, Date, console, ...sandbox,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return exports;
}

function helperFixture({ recipient = { email: "m@example.com", name: "Mara" }, enqueueFails = false, created = true } = {}) {
  const state = { enqueued: [], sent: [], sentry: [] };
  const exports = loadModule("src/lib/caseEmail.ts", {
    "@sentry/nextjs": { captureException: (error) => state.sentry.push(error) },
    "@/lib/email": { renderCaseUpdateEmail: (input) => ({ to: input.to, subject: input.heading, html: input.message }) },
    "@/lib/emailOutbox": {
      enqueueEmailOutboxOnce: async (job) => {
        if (enqueueFails) throw new Error("outbox down");
        state.enqueued.push(job);
        return { job: { id: "job" }, created };
      },
      processEmailOutboxJobById: async (id) => {
        state.sent.push(id);
        return "sent";
      },
    },
    "@/lib/emailOutboxImmediate": {
      processNewlyEnqueuedEmailOutboxJob: (enqueued, run) => (enqueued.created ? run(enqueued.job.id) : null),
    },
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipient: async () => recipient },
  });
  return { state, exports };
}

const update = {
  caseId: "case", orderId: "order", userId: "user", side: "BUYER",
  dedupKey: "key", heading: "Heading", message: "Message",
};

test("a Case update is queued durably and attempted at once", async () => {
  const subject = helperFixture();
  await subject.exports.sendCaseUpdateEmail(update);
  assert.equal(subject.state.enqueued[0].dedupKey, "key");
  assert.equal(subject.state.enqueued[0].sourceType, "case");
  assert.deepEqual(subject.state.sent, ["job"]);
});

test("a cron batch leaves delivery to the worker", async () => {
  const subject = helperFixture();
  await subject.exports.sendCaseUpdateEmail({ ...update, sendNow: false });
  assert.equal(subject.state.enqueued.length, 1);
  assert.deepEqual(subject.state.sent, []);
});

test("a replay does not send twice", async () => {
  const subject = helperFixture({ created: false });
  await subject.exports.sendCaseUpdateEmail(update);
  assert.deepEqual(subject.state.sent, []);
});

test("an unavailable recipient gets nothing, and a failure never fails the Case action", async () => {
  const none = helperFixture({ recipient: null });
  await none.exports.sendCaseUpdateEmail(update);
  assert.equal(none.state.enqueued.length, 0);

  const failing = helperFixture({ enqueueFails: true });
  await failing.exports.sendCaseUpdateEmail(update);
  assert.equal(failing.state.sentry.length, 1);
});

test("opening a Case queues the maker's 48-hour notice", async () => {
  const state = { queued: [], updates: [] };
  const exports = loadModule("src/app/api/cases/route.ts", {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "buyer", name: "Bea" }) },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (json, init) => Response.json(json, init),
      privateResponse: (response) => response,
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/userEmailDeliveryAccess": {
      userEmailDeliveryRecipient: async () => ({ email: "m@example.com", name: "Mara" }),
    },
    "@/lib/email": { renderCaseOpenedEmail: () => ({ to: "m@example.com", subject: "s", html: "h" }) },
    "@/lib/caseEmail": {
      queueCaseEmail: async (job) => state.queued.push(job),
      sendCaseUpdateEmail: async (job) => state.updates.push(job),
    },
    "@/lib/caseOpenAuthority": {
      openCaseWithFixedAuthority: async () => ({
        action: "created",
        caseId: "case",
        orderId: "order",
        buyerUserId: "buyer",
        sellerUserId: "seller",
        reason: "DAMAGED",
        status: "OPEN",
      }),
    },
    "@/lib/notifications": { createNotification: async () => {} },
    "@/lib/caseMessageBody": {
      normalizeCaseDescriptionBody: (body) => ({ ok: true, body }),
    },
    "@/lib/sanitize": { truncateText: (text) => text },
  }, { Error });
  const response = await exports.POST(new Request("https://example.test/api/cases", {
    method: "POST",
    body: JSON.stringify({ orderId: "order", reason: "DAMAGED", description: "It arrived with a cracked top." }),
  }));
  assert.equal(response.status, 201);
  assert.equal(state.queued[0].dedupKey, "case-opened:case");
  assert.equal(state.queued[0].userId, "seller");
});
