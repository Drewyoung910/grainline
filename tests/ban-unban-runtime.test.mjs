import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/lib/ban.ts";

// The real unban flow with its ports stubbed. Nothing here exercises the database.
function fixture({
  clerkLookup = async () => true,
  seller = { id: "seller", stripeAccountId: null, chargesEnabled: false, vacationMode: true },
  banMetadata = {},
  stripeFails = false,
} = {}) {
  const state = { transactions: 0, transitions: [], commissionUpdates: [], audits: [] };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const tx = {
    adminAuditLog: {
      create: async ({ data }) => {
        state.audits.push(data);
        return { id: "audit" };
      },
    },
    commissionRequest: {
      updateMany: async (args) => {
        state.commissionUpdates.push(args);
        return { count: 1 };
      },
    },
  };
  const dependencies = {
    "./db": {
      prisma: {
        adminAuditLog: {
          findFirst: async () => ({ metadata: banMetadata }),
        },
      },
    },
    "./stripe": {
      stripe: {
        accounts: {
          retrieve: async () => {
            if (stripeFails) throw new Error("stripe down");
            return { charges_enabled: true, details_submitted: true, requirements: {} };
          },
        },
      },
    },
    "./banAuditMetadata": {
      buildBanAuditMetadata: () => ({}),
      readBanAuditMetadata: (value) => ({
        appliedBannedAt: null,
        externalSyncVersion: null,
        previousSellerProfile: null,
        previousCommissionRequests: [],
        flaggedOpenOrders: [],
        ...value,
      }),
    },
    "./clerkUserLifecycle": {
      banClerkUserAndRevokeSessions: async () => ({ revokedSessionCount: 0 }),
      clerkUserExists: clerkLookup,
      unbanClerkUser: async () => {},
    },
    "./orderBanReviewAuthority": {
      flagBannedSellerOpenOrders: async () => [],
      mintBanReviewCapability: async () => "review-capability",
      restoreBannedSellerOrderReviews: async () => [],
    },
    "./orderStaffReadDb": { getOrderStaffReadClient: () => ({}) },
    "./emailOutboxSanitize": { sanitizeEmailOutboxError: (error) => String(error) },
    "./audit": { sanitizeAdminAuditReason: (reason) => reason },
    "./banSideEffectRepair": { repairBanUserExternalSideEffects: async () => {} },
    "./dbUserContext": {
      withDbUserContext: async (_id, callback) => {
        state.transactions += 1;
        return callback(tx);
      },
    },
    "./userStaffAccess": {
      mintUserStaffCapability: async () => "capability",
      userStaffBanApply: async () => ({}),
      userStaffBanTarget: async () => ({
        id: "user", role: "USER", banned: true, bannedAt: new Date(1), deletedAt: null, clerkId: "clerk",
      }),
      userStaffUnbanApply: async () => ({ clerkId: "clerk", banned: true, bannedAt: new Date(1), banReason: "r", bannedBy: "a" }),
    },
    "./sellerStaffPrivateAccess": {
      sellerStaffOrderabilityState: async () => seller,
      transitionSellerStaffOrderability: async (_tx, input) => {
        state.transitions.push(input);
        return null;
      },
    },
    "./accountStateCache": { invalidateAccountStateCache: async () => {} },
    "./searchCache": { revalidatePublicSellerVisibilityCaches: () => {} },
    "@sentry/nextjs": { captureException: () => {} },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Date, console, Error, Boolean, Set, Map, Promise,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    exports,
    unban: () => exports.unbanUser({ userId: "user", adminId: "admin", reason: "reason" }),
  };
}

test("an account deleted in Clerk and waiting for cleanup cannot be unbanned", async () => {
  const subject = fixture({ clerkLookup: async () => false });
  await assert.rejects(subject.unban(), (error) => {
    assert.equal(error.status, 409);
    assert.match(error.message, /deleted/);
    return true;
  });
  assert.equal(subject.state.transactions, 0);
});

test("a Clerk outage stops the unban before anything local changes", async () => {
  const subject = fixture({
    clerkLookup: async () => {
      throw new Error("clerk down");
    },
  });
  await assert.rejects(subject.unban(), (error) => error.status === 503);
  assert.equal(subject.state.transactions, 0);
});

test("a maker with no Stripe account does not stay stuck on vacation after an unban", async () => {
  const subject = fixture({
    banMetadata: {
      previousSellerProfile: { id: "seller", chargesEnabled: false, vacationMode: false },
    },
  });
  await subject.unban();
  assert.equal(subject.state.transitions[0].next.chargesEnabled, false);
  assert.equal(subject.state.transitions[0].next.vacationMode, false);
});

test("a maker who chose vacation before the ban stays on vacation", async () => {
  const subject = fixture({
    banMetadata: {
      previousSellerProfile: { id: "seller", chargesEnabled: false, vacationMode: true },
    },
  });
  await subject.unban();
  assert.equal(subject.state.transitions[0].next.vacationMode, true);
});

test("a manual unban reopens the commission requests the ban closed", async () => {
  const subject = fixture({
    banMetadata: {
      previousCommissionRequests: [{ id: "commission", status: "OPEN" }],
    },
  });
  await subject.unban();
  assert.equal(subject.state.commissionUpdates.length, 1);
  const update = subject.state.commissionUpdates[0];
  assert.equal(update.where.id, "commission");
  assert.equal(update.where.status, "CLOSED");
  assert.equal(update.data.status, "OPEN");
});
