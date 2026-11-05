import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/admin/listings/[id]/review/route.ts";

async function decide(action, reason) {
  const state = { rendered: [], sent: 0 };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", sessionId: "s" }) },
    "next/server": { after: () => {}, NextRequest: Request },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role: "ADMIN", banned: false, deletedAt: null }) },
    "@/lib/ratelimit": {
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      adminActionRatelimit: {},
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/adminPinApi": { requireStaffAdminPinForApi: async () => null },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/privateResponse": { privateJson: (json, init) => Response.json(json, init), privateResponse: (r) => r },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/sanitize": { sanitizeText: (text) => text, truncateText: (text) => text },
    "@/lib/sellerProfileStaffAccess": {
      sellerProfileStaffListingReviewTransition: async () => ({
        applied: true,
        auditId: "audit",
        blockReason: null,
        listing: {
          id: "listing", title: "Bench", sellerId: "seller", status: action === "approve" ? "ACTIVE" : "REJECTED",
          priceCents: 100, currency: "usd", reservedForUserId: null, customOrderConversationId: null,
          seller: { userId: "maker", displayName: "Shop", chargesEnabled: true, vacationMode: false, ownerAccountActive: true },
        },
      }),
    },
    "@/lib/notifications": { createNotification: async () => {} },
    "@/lib/firstListingEmail": { sendFirstListingCongratsIfFirst: async () => {} },
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipient: async () => ({ email: "m@example.com", name: "Mara" }) },
    "@/lib/email": {
      renderListingDecisionEmail: (input) => {
        state.rendered.push(input);
        return { to: input.to, subject: "s", html: "h" };
      },
      sendRenderedEmail: async () => {
        state.sent += 1;
      },
    },
    "@/lib/emailBaseUrl": { EMAIL_APP_URL: "https://example.test" },
    "@/lib/publicPaths": { publicListingPath: (id) => `/listing/${id}` },
    "@/lib/foundingMaker": { maybeGrantFoundingMaker: async () => {} },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  const response = await exports.PATCH(
    new Request("https://example.test/x", { method: "PATCH", body: JSON.stringify({ action, reason }) }),
    { params: Promise.resolve({ id: "listing" }) },
  );
  return { state, response };
}

test("an approval is emailed with a link to the live listing", async () => {
  const { state, response } = await decide("approve", null);
  assert.equal(response.status, 200);
  assert.equal(state.sent, 1);
  assert.equal(state.rendered[0].approved, true);
  assert.equal(state.rendered[0].listingUrl, "https://example.test/listing/listing");
});

test("a rejection is emailed with the reason and a link to edit", async () => {
  const { state } = await decide("reject", "Photos are blurry");
  assert.equal(state.rendered[0].approved, false);
  assert.equal(state.rendered[0].reason, "Photos are blurry");
  assert.equal(state.rendered[0].listingUrl, "https://example.test/dashboard/listings/listing/edit");
});
