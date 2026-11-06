import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";
import { listingEditBlockReason } from "../src/lib/listingEditState.ts";
import { publishListingBlockReason } from "../src/lib/listingActionState.ts";
import * as sanitize from "../src/lib/sanitize.ts";

const require = createRequire(import.meta.url);
const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });

function load(path, dependencies, globals = {}) {
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    Date,
    Response,
    require: (name) => dependencies[name] ?? stub(),
    ...globals,
  }, { filename: path });
  return exports;
}

// The real email module, with the provider as the only thing replaced, so the test
// reads what would really be sent. The route is real too. Database calls are ports.
function realEmail(sent, { providerFails = false } = {}) {
  return load("src/lib/email.ts", {
    "@/lib/sanitize": sanitize,
    "@/lib/env": { requiredProductionEnv: () => "from@grainline.test" },
    "@/lib/emailBaseUrl": { EMAIL_APP_URL: "https://grainline.test" },
    "@/lib/emailSuppression": {
      normalizeEmailAddress: (email) => email,
      isEmailDeliverySuppressed: async () => false,
    },
    "@/lib/userEmailDeliveryAccess": { userEmailAccountStateByEmail: async () => null },
    "@/lib/emailText": { htmlToText: (html) => html },
    "@/lib/emailOutboxSanitize": { sanitizeEmailOutboxError: () => "failed" },
    "@/lib/emailRetry": {
      sendEmailProviderRequestWithRetry: async (request) => {
        if (providerFails) throw new Error("provider down");
        return request("key").then(() => ({ id: "sent" }));
      },
    },
    resend: {
      Resend: class {
        emails = { send: async (email) => { sent.push(email); return { data: { id: "sent" } }; } };
      },
    },
  }, { process: { env: { RESEND_API_KEY: "test" } }, console, URL });
}

function fixture({ role = "ADMIN", providerFails = false, recipient = { email: "maker@example.test" } } = {}) {
  const state = { updates: [], audits: [], sent: [], captured: [] };
  const email = realEmail(state.sent, { providerFails });
  const exports = load("src/app/api/admin/listings/[id]/route.ts", {
    zod: require("zod"),
    "@sentry/nextjs": { captureException: (error) => state.captured.push(error) },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/db": {
      prisma: {
        listing: {
          findUnique: async () => ({
            id: "listing", title: "Walnut bench", sellerId: "seller", status: "ACTIVE", isPrivate: false, rejectionReason: null,
          }),
        },
      },
    },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role, banned: false, deletedAt: null }) },
    "@/lib/audit": { logAdminActionOrThrow: async (entry) => { state.audits.push(entry); return "audit"; } },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }), adminActionRatelimit: {} },
    "@/lib/dbUserContext": {
      withDbUserContext: (_id, callback) => callback({
        listing: { update: async (args) => state.updates.push(args) },
      }),
    },
    "@/lib/guildListingThreshold": { syncGuildMemberListingThreshold: async () => {} },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: (error) => error instanceof SyntaxError,
    },
    "@/lib/sanitize": sanitize,
    "@/lib/email": email,
    "@/lib/listingActionState": { STAFF_REMOVAL_REJECTION_REASON: "Removed by Grainline staff." },
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipient: async () => recipient },
    "@/lib/sellerProfileListingDetailAccess": { sellerStaffListingDetailProfile: async () => ({ userId: "maker" }) },
  }, { SyntaxError });
  return {
    state,
    remove: (body) => exports.DELETE(
      new Request("https://example.test/api/admin/listings/listing", {
        method: "DELETE",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: Promise.resolve({ id: "listing" }) },
    ),
  };
}

const REASON = "Hateful language in the description";

test("removing a listing requires a reason and changes nothing without one", async () => {
  for (const body of [undefined, {}, { reason: "" }, { reason: "   " }]) {
    const subject = fixture();
    assert.equal((await subject.remove(body)).status, 400);
    assert.equal(subject.state.updates.length, 0);
    assert.equal(subject.state.audits.length, 0);
    assert.equal(subject.state.sent.length, 0);
  }
});

test("the maker sees the reason on the edit page, and the listing stays locked", async () => {
  const subject = fixture();
  assert.equal((await subject.remove({ reason: REASON })).status, 200);
  const { data } = subject.state.updates[0];
  assert.equal(data.status, "REJECTED");
  assert.equal(subject.state.audits[0].reason, REASON);

  const saved = { ...data, listingType: "MADE_TO_ORDER" };
  assert.match(listingEditBlockReason(saved), /removed by Grainline staff/);
  assert.ok(listingEditBlockReason(saved).includes(REASON));
  assert.match(publishListingBlockReason(saved), /cannot be resubmitted/);
});

test("the maker is emailed the reason", async () => {
  const subject = fixture();
  await subject.remove({ reason: REASON });
  assert.deepEqual(subject.state.captured, []);
  assert.equal(subject.state.sent.length, 1);
  assert.equal(subject.state.sent[0].to, "maker@example.test");
  assert.ok(subject.state.sent[0].html.includes(REASON));
  assert.ok(subject.state.sent[0].html.includes("Walnut bench"));
});

test("a failed email or an unavailable maker does not undo the removal", async () => {
  for (const options of [{ providerFails: true }, { recipient: null }]) {
    const subject = fixture(options);
    assert.equal((await subject.remove({ reason: REASON })).status, 200);
    assert.equal(subject.state.updates.length, 1);
    assert.equal(subject.state.sent.length, 0);
  }
});

test("an employee still cannot remove a listing, because the cleanup functions require ADMIN", async () => {
  const subject = fixture({ role: "EMPLOYEE" });
  assert.equal((await subject.remove({ reason: REASON })).status, 403);
  assert.equal(subject.state.updates.length, 0);
});
