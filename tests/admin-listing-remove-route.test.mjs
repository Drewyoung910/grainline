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
  const state = { transitions: [], sent: [], captured: [] };
  const email = realEmail(state.sent, { providerFails });
  const exports = load("src/app/api/admin/listings/[id]/route.ts", {
    zod: require("zod"),
    "@sentry/nextjs": { captureException: (error) => state.captured.push(error) },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/db": { prisma: {} },
    "@/lib/orderStaffReadDb": { getOrderStaffReadClient: () => ({}) },
    "@/lib/sellerProfileStaffAccess": {
      sellerProfileStaffListingRemovalTransition: async (_client, input) => {
        state.transitions.push(input);
        return {
          applied: true,
          auditId: "audit",
          blockReason: null,
          listing: {
            id: "listing",
            title: "Walnut bench",
            sellerId: "seller",
            previousStatus: "ACTIVE",
            previousIsPrivate: false,
            previousRejectionReason: null,
          },
          removedFavorites: 0,
          removedStockNotifications: 0,
          removedCartItems: 0,
        };
      },
    },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role, banned: false, deletedAt: null }) },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }), adminActionRatelimit: {} },
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
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipient: async () => recipient },
    "@/lib/sellerProfileListingDetailAccess": { sellerStaffListingDetailProfile: async () => ({ userId: "maker" }) },
    "next/server": { after: () => {} },
    "next/cache": { revalidatePath: () => {} },
    "@/lib/searchCache": { revalidateListingSearchCaches: () => {}, revalidateFeaturedMakerCaches: () => {} },
    "@/lib/checkoutSessionExpiry": { expireOpenCheckoutSessionsForListing: async () => {} },
    "@/lib/adminPinApi": { requireStaffAdminPinForApi: async () => null },
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
const REVIEWED_AT = "2026-11-17T12:00:00.000Z";
const removalBody = (reason = REASON) => ({ reason, reviewedAt: REVIEWED_AT });

test("removing a listing requires a reason and changes nothing without one", async () => {
  for (const body of [undefined, {}, { reason: "", reviewedAt: REVIEWED_AT }, { reason: "   ", reviewedAt: REVIEWED_AT }]) {
    const subject = fixture();
    assert.equal((await subject.remove(body)).status, 400);
    assert.equal(subject.state.transitions.length, 0);
    assert.equal(subject.state.sent.length, 0);
  }
});

test("the maker sees the reason on the edit page, and the listing stays locked", async () => {
  const subject = fixture();
  assert.equal((await subject.remove(removalBody())).status, 200);
  assert.equal(subject.state.transitions[0].reason, REASON);
  assert.equal(subject.state.transitions[0].reviewedAt.toISOString(), REVIEWED_AT);

  const saved = { status: "REJECTED", rejectionReason: `Removed by Grainline staff. Reason: ${REASON}`, listingType: "MADE_TO_ORDER" };
  assert.match(listingEditBlockReason(saved), /removed by Grainline staff/);
  assert.ok(listingEditBlockReason(saved).includes(REASON));
  assert.match(publishListingBlockReason(saved), /cannot be resubmitted/);
});

test("the maker is emailed the reason", async () => {
  const subject = fixture();
  await subject.remove(removalBody());
  assert.deepEqual(subject.state.captured, []);
  assert.equal(subject.state.sent.length, 1);
  assert.equal(subject.state.sent[0].to, "maker@example.test");
  assert.ok(subject.state.sent[0].html.includes(REASON));
  assert.ok(subject.state.sent[0].html.includes("Walnut bench"));
});

test("a failed email or an unavailable maker does not undo the removal", async () => {
  for (const options of [{ providerFails: true }, { recipient: null }]) {
    const subject = fixture(options);
    assert.equal((await subject.remove(removalBody())).status, 200);
    assert.equal(subject.state.transitions.length, 1);
    assert.equal(subject.state.sent.length, 0);
  }
});

test("an employee still cannot remove a listing, because the cleanup functions require ADMIN", async () => {
  const subject = fixture({ role: "EMPLOYEE" });
  assert.equal((await subject.remove(removalBody())).status, 403);
  assert.equal(subject.state.transitions.length, 0);
});
