import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const path = "src/app/api/seller/analytics/recent-sales/route.ts";

function fixture({ onboardingComplete, chargesEnabled, orderCount }) {
  const state = { salesReads: 0 };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "maker" }) },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/ratelimit": {
      sellerAnalyticsRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => Response.json({}, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/orderSellerAnalyticsAuthority": {
      readSellerRecentSales: async () => { state.salesReads += 1; return []; },
    },
    "@/lib/orderParticipantReadAuthority": { countSellerOrders: async () => orderCount },
    "@/lib/sellerOwnerPrivateAccess": { sellerOwnerPrivateState: async () => ({ onboardingComplete }) },
    "@/lib/sellerProfileOwnerAccess": {
      sellerOwnerCore: async () => ({ sellerProfileId: "sp", chargesEnabled }),
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Response, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, get: () => exports.GET() };
}

test("a maker who can take payments sees sales without finishing the wizard", async () => {
  const subject = fixture({ onboardingComplete: false, chargesEnabled: true, orderCount: 0 });
  assert.equal((await subject.get()).status, 200);
  assert.equal(subject.state.salesReads, 1);
});

test("a maker with past orders sees them even if payouts are off now", async () => {
  const subject = fixture({ onboardingComplete: false, chargesEnabled: false, orderCount: 3 });
  assert.equal((await subject.get()).status, 200);
});

test("a shop with no payouts and no orders is still told to finish setup", async () => {
  const subject = fixture({ onboardingComplete: false, chargesEnabled: false, orderCount: 0 });
  const response = await subject.get();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "SETUP_REQUIRED");
  assert.equal(subject.state.salesReads, 0);
});
