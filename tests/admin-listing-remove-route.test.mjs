import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/admin/listings/[id]/route.ts";

// Actual route with isolated ports. Database behavior is not exercised here.
function fixture({ role = "ADMIN", notificationFails = false } = {}) {
  const state = { updates: [], audits: [], notifications: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/db": {
      prisma: {
        listing: {
          findUnique: async () => ({
            id: "listing", title: "Bench", sellerId: "seller", status: "ACTIVE", isPrivate: false, rejectionReason: null,
          }),
        },
      },
    },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "admin", role, banned: false, deletedAt: null }) },
    "@/lib/audit": {
      logAdminActionOrThrow: async (entry) => {
        state.audits.push(entry);
        return "audit";
      },
    },
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
    "@/lib/sanitize": { sanitizeText: (text) => text, truncateText: (text) => text },
    "@/lib/notifications": {
      createNotification: async (input) => {
        if (notificationFails) throw new Error("down");
        state.notifications.push(input);
      },
    },
    "@/lib/notificationSources": { NOTIFICATION_SOURCE_TYPES: { LISTING_ADMIN_REVIEW: "source" } },
    "@/lib/sellerProfileListingDetailAccess": { sellerStaffListingDetailProfile: async () => ({ userId: "maker" }) },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, SyntaxError,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
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

test("removing a listing requires a reason and changes nothing without one", async () => {
  for (const body of [undefined, {}, { reason: "" }, { reason: "   " }]) {
    const subject = fixture();
    assert.equal((await subject.remove(body)).status, 400);
    assert.equal(subject.state.updates.length, 0);
    assert.equal(subject.state.audits.length, 0);
  }
});

test("removing a listing audits the reason and tells the maker why", async () => {
  const subject = fixture();
  assert.equal((await subject.remove({ reason: "Hateful language in the description" })).status, 200);
  assert.equal(subject.state.updates[0].data.status, "REJECTED");
  assert.equal(subject.state.audits[0].reason, "Hateful language in the description");
  assert.equal(subject.state.notifications[0].userId, "maker");
  assert.match(subject.state.notifications[0].body, /Hateful language in the description/);
});

test("a failed maker notice does not undo the removal", async () => {
  const subject = fixture({ notificationFails: true });
  assert.equal((await subject.remove({ reason: "Reason" })).status, 200);
  assert.equal(subject.state.updates.length, 1);
});

test("an employee still cannot remove a listing, because the cleanup functions require ADMIN", async () => {
  const subject = fixture({ role: "EMPLOYEE" });
  assert.equal((await subject.remove({ reason: "Reason" })).status, 403);
  assert.equal(subject.state.updates.length, 0);
});
