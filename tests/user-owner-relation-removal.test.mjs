import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { auditUserIndirectAccess } from "../scripts/audit-user-indirect-access.mjs";

const require = createRequire(import.meta.url);

function load(file, mocks, suffix = "") {
  const source = readFileSync(file, "utf8") + suffix;
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require: (name) => name === "zod" ? require(name) : mocks[name] ?? {},
    URL,
    Date,
  }, { filename: file });
  return exports;
}

test("onboarding resolves Clerk owner and denies unavailable accounts before reading seller", async () => {
  let owner = { id: "local_owner", banned: false, deletedAt: null };
  const queries = [];
  const db = {
    sellerProfile: {
      findUnique: async (query) => {
        queries.push(query);
        return { id: "seller", userId: "local_owner", onboardingStep: 2, chargesEnabled: false, _count: { listings: 1 } };
      },
    },
  };
  const loaded = load("src/app/dashboard/onboarding/actions.ts", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk_owner" }) },
    "@/lib/db": { prisma: db },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/userIdentityAccess": {
      userAccountByClerkId: async (client, clerkId) => {
        assert.equal(client, db);
        assert.equal(clerkId, "clerk_owner");
        return owner;
      },
    },
  }, "\nexport { getSeller as testGetSeller };\n");
  const seller = await loaded.testGetSeller();
  assert.equal(seller.userId, "local_owner");
  assert.equal(queries.length, 1);
  assert.equal(queries[0].where.userId, "local_owner");
  assert.equal("user" in queries[0].select, false);
  for (const unavailable of [null, { ...owner, banned: true }, { ...owner, deletedAt: new Date() }]) {
    owner = unavailable;
    await assert.rejects(loaded.testGetSeller(), /No seller profile|Account suspended/);
  }
  assert.equal(queries.length, 1);
});

test("Stripe Connect creation uses authenticated owner email without a nested User projection", async () => {
  const operations = [];
  const loaded = load("src/app/api/stripe/connect/create/route.ts", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk_owner" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "local_owner", email: "owner@example.com" }) },
    "@/lib/db": { prisma: { sellerProfile: {
      findUnique: async (query) => {
        assert.equal(query.where.userId, "local_owner");
        assert.equal("user" in query.select, false);
        return { id: "seller", stripeAccountId: null, stripeAccountVersion: null, chargesEnabled: false, shipFromCountry: "US" };
      },
      update: async (query) => { operations.push(["persist", query.data.stripeAccountId]); },
    } } },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/requestBody": { readOptionalBoundedJson: async () => ({}) },
    "@/lib/internalReturnUrl": { safeInternalReturnUrl: () => null },
    "@/lib/stripeConnectV2": {
      createStripeConnectV2Account: async (input) => { operations.push(["create", input.email, input.idempotencyKey]); return { id: "acct_test" }; },
    },
    "@/lib/stripe": { stripe: { accountLinks: { create: async (input) => { operations.push(["link", input.account]); return { url: "https://test.example/onboarding" }; } } } },
    "@/lib/appBaseUrl": { APP_BASE_URL: "https://app.example" },
    "@/lib/privateResponse": { privateJson: (body) => body },
  });
  const result = await loaded.POST({});
  assert.equal(result.url, "https://test.example/onboarding");
  assert.deepEqual(operations, [["create", "owner@example.com", "connect-v2-account:seller"], ["persist", "acct_test"], ["link", "acct_test"]]);
});

test("converted owner and cart surfaces have no remaining statically visible User relation", () => {
  const report = auditUserIndirectAccess(process.cwd());
  const files = new Set([
    "src/app/api/stripe/connect/create/route.ts",
    "src/app/api/verification/apply/route.ts",
    "src/app/dashboard/onboarding/actions.ts",
    "src/app/dashboard/profile/page.tsx",
    "src/app/dashboard/verification/page.tsx",
    "src/app/api/cart/add/route.ts",
    "src/app/api/cart/update/route.ts",
    "src/app/api/cart/checkout/single/route.ts",
    "src/app/api/cart/checkout/single/resume/route.ts",
    "src/app/api/shipping/quote/route.ts",
    "src/lib/cartOwnerAccess.ts",
  ]);
  assert.deepEqual(report.relations.filter(({ query }) => files.has(query.file)), []);
  const ownerFiles = new Set([...files].filter((file) => !file.includes("/cart/") && !file.includes("/shipping/") && file !== "src/lib/cartOwnerAccess.ts"));
  assert.deepEqual(report.opaqueShapes.filter(({ query }) => ownerFiles.has(query.file)), []);
});
