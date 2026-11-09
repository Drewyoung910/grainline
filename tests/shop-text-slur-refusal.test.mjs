import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const profanity = await import("../src/lib/profanity.ts");
const sanitize = await import("../src/lib/sanitize.ts");
const { SHOP_TEXT_SLUR_MESSAGE, SLUR_WORDS, MILD_WORDS } = profanity;
const SLUR = SLUR_WORDS[0];

// Runs the real action with every other dependency stubbed. Each stub call that
// could write is counted, so a refused save has to stop before any of them.
function load(path, exportName) {
  const calls = { writes: 0, redirects: [] };
  const write = async (...args) => {
    calls.writes += 1;
    const callback = args.find((arg) => typeof arg === "function");
    return callback ? callback({}) : { duplicateDisplayName: false };
  };
  const stub = (label) => new Proxy(function () {}, {
    get: (_target, key) => (key === "__esModule" ? false : stub(`${label}.${String(key)}`)),
    apply: () => undefined,
  });
  const seller = {
    id: "seller", userId: "user", sellerProfileId: "seller", displayName: "Shop",
    onboardingStep: 1, chargesEnabled: true, _count: { listings: 0 }, galleryImageUrls: [],
  };
  const dependencies = {
    zod: require("zod"),
    "@/lib/profanity": profanity,
    "@/lib/sanitize": sanitize,
    "@/lib/sellerProfileText": {
      SELLER_PROFILE_TEXT_LIMITS: {},
      cleanSellerProfileRichText: (value) => (value ? String(value) : null),
    },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ratelimit": new Proxy({}, {
      get: (_target, key) => (key === "safeRateLimit" ? async () => ({ success: true }) : {}),
    }),
    "@/lib/ensureSeller": { ensureSeller: async () => ({ seller, me: { id: "user" } }) },
    "@/lib/userIdentityAccess": {
      userAccountByClerkId: async () => ({ id: "user" }),
      userClerkCommissionContext: async () => ({ id: "user", banned: false, deletedAt: null }),
    },
    "@/lib/sellerOwnerPrivateAccess": new Proxy({}, {
      get: (_target, key) => (key === "sellerOwnerOnboardingMutationState" ? async () => seller : write),
    }),
    "@/lib/dbUserContext": { withDbUserContext: write },
    "@/lib/uploadPersistenceVerification": { filterVerifiedFirstPartyMediaUrlsForUser: async () => [] },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 } },
    "@/lib/sellerProfileOwnerAccess": { sellerOwnerVacationUpdate: write },
    "next/navigation": {
      redirect: (target) => {
        calls.redirects.push(target);
        throw new Error("redirected");
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {};
  vm.runInNewContext(`${javascript}\nexports.__action = ${exportName};`, {
    exports, Date, Response, URL, FormData, Set, Map, console,
    require: (name) => dependencies[name] ?? stub(name),
  }, { filename: path });
  return { action: exports.__action, calls };
}

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("shop text saves refuse slur-tier words and keep mild words", () => {
  const paths = [
    ["profile bio", "src/app/dashboard/profile/page.tsx", "updateSellerProfile", (text) => [null, form({ displayName: "Shop", bio: text })]],
    ["profile name", "src/app/dashboard/profile/page.tsx", "updateSellerProfile", (text) => [null, form({ displayName: text })]],
    ["onboarding step 1", "src/app/dashboard/onboarding/actions.ts", "saveStep1", (text) => [form({ displayName: "Shop", tagline: text })]],
    ["onboarding step 2", "src/app/dashboard/onboarding/actions.ts", "saveStep2", (text) => [form({ returnPolicy: text })]],
  ];

  for (const [name, path, exportName, args] of paths) {
    it(`${name}: refused with a clear message, and nothing is written`, async () => {
      const { action, calls } = load(path, exportName);
      const result = await action(...args(`Thanks. ${SLUR}.`));
      assert.equal(result.ok, false);
      assert.equal(result.error, SHOP_TEXT_SLUR_MESSAGE);
      assert.equal(calls.writes, 0);
    });

    it(`${name}: a mild word still saves`, async () => {
      const { action, calls } = load(path, exportName);
      await action(...args(`Thanks. ${MILD_WORDS[0]}.`)).catch(() => {});
      assert.equal(calls.writes > 0, true);
    });
  }

  it("FAQ: a refused answer redirects to the warning banner and is not saved", async () => {
    const { action, calls } = load("src/app/dashboard/profile/page.tsx", "addFaq");
    await assert.rejects(action(form({ question: "Lead time?", answer: SLUR })), /redirected/);
    assert.deepEqual(calls.redirects, ["/dashboard/profile?warning=blocked-language"]);
    assert.equal(calls.writes, 0);
  });

  for (const [name, path, exportName, body, params] of [
    ["review create", "src/app/api/reviews/route.ts", "POST", (text) => ({ listingId: "listing", ratingX2: 10, comment: text })],
    ["review edit", "src/app/api/reviews/[id]/route.ts", "PATCH", (text) => ({ ratingX2: 10, comment: text }), { params: Promise.resolve({ id: "review" }) }],
    ["commission request", "src/app/api/commission/route.ts", "POST", (text) => ({ title: "Walnut desk", description: text })],
  ]) {
    it(`${name}: refused with a clear message, and nothing is written`, async () => {
      const { action, calls } = load(path, exportName);
      const response = await action(new Request("https://example.test/api", {
        method: exportName,
        body: JSON.stringify(body(`A long enough request. ${SLUR}.`)),
      }), params);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, SHOP_TEXT_SLUR_MESSAGE);
      assert.equal(calls.writes, 0);
    });
  }

  it("vacation message: refused with a clear message, and nothing is written", async () => {
    const { action, calls } = load("src/app/api/seller/vacation/route.ts", "POST");
    const response = await action(new Request("https://example.test/api/seller/vacation", {
      method: "POST",
      body: JSON.stringify({ vacationMode: true, vacationMessage: `Back soon. ${SLUR}` }),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, SHOP_TEXT_SLUR_MESSAGE);
    assert.equal(calls.writes, 0);
  });
});
