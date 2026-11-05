import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";
import { heldCheckoutFromResume } from "../src/lib/cartCheckoutHold.ts";

const openEntry = { sellerId: "seller", sellerName: "Maker", secret: "cs_1_secret_x", sessionId: "cs_1" };

test("an open session is a hold; a finished one is not", () => {
  assert.deepEqual(heldCheckoutFromResume({ clientSecrets: [openEntry], completedSessionIds: [] }), {
    sellerIds: ["seller"],
    sessionIds: ["cs_1"],
  });
  assert.equal(heldCheckoutFromResume({ clientSecrets: [], completedSessionIds: ["cs_old"] }), null);
  assert.equal(heldCheckoutFromResume({ error: "nope" }), null);
  assert.equal(heldCheckoutFromResume(null), null);
});

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function resumeRoute() {
  const path = "src/app/api/cart/checkout/resume/route.ts";
  const state = { limiters: [], completedLookups: 0, retrieved: [] };
  const checkoutLimiter = { name: "checkout" };
  const readLimiter = { name: "read" };
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "buyer" }), isAccountAccessError: () => false },
    "@/lib/checkoutSessionLock": {
      cartCheckoutLockKey: () => "lock",
      getCheckoutLock: async () => ({ state: "ready", sessionId: "cs_1", clientSecret: "cs_1_secret_x" }),
    },
    "@/lib/stripe": {
      stripe: {
        checkout: {
          sessions: {
            retrieve: async (id) => {
              state.retrieved.push(id);
              return {
                id,
                status: "open",
                payment_status: "unpaid",
                client_secret: "cs_1_secret_x",
                metadata: { buyerId: "buyer", cartId: "cart", sellerId: "seller", checkoutLockKey: "lock" },
              };
            },
          },
        },
      },
    },
    "@/lib/ratelimit": {
      checkoutRatelimit: checkoutLimiter,
      cartReadRatelimit: readLimiter,
      safeRateLimit: async (limiter) => {
        state.limiters.push(limiter.name);
        return { success: true, reset: 0 };
      },
      rateLimitResponse: () => Response.json({}, { status: 429 }),
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/cartOwnerAccess": {
      ownerCartForCheckoutResume: async () => ({
        id: "cart",
        items: [{ listing: { sellerId: "seller", seller: { displayName: "Maker", userId: "maker" } } }],
      }),
    },
    "@/lib/checkoutStockReservationAuthority": {
      resumeCheckoutStockReservations: async () => {
        state.completedLookups += 1;
        return [];
      },
    },
    "@/lib/blocks": { getBlockedUserIdsFor: async () => new Set() },
  };
  const exports = {};
  vm.runInNewContext(compile(readFileSync(path, "utf8")), {
    exports, Response, URL, Map, Set, Array, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return { state, get: (query = "") => exports.GET(new Request(`https://example.test/api/cart/checkout/resume${query}`)) };
}

test("the cart's question on load spends no checkout attempts and looks up no finished sessions", async () => {
  const subject = resumeRoute();
  const response = await subject.get("?open=1");
  assert.equal(response.status, 200);
  assert.deepEqual(subject.state.limiters, ["read"]);
  assert.equal(subject.state.completedLookups, 0);
  assert.deepEqual(heldCheckoutFromResume(await response.json()), { sellerIds: ["seller"], sessionIds: ["cs_1"] });
});

test("resuming on the payment step keeps its checkout limit and the finished-session lookup", async () => {
  const subject = resumeRoute();
  const response = await subject.get();
  assert.equal(response.status, 200);
  assert.deepEqual(subject.state.limiters, ["checkout"]);
  assert.equal(subject.state.completedLookups, 1);
});

function cartPageFunction(name) {
  const path = "src/app/cart/page.tsx";
  const text = readFileSync(path, "utf8");
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(sf);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(found, `${name} is absent`);
  return found;
}

test("changing a held line releases the hold before the server judges the change", async () => {
  const calls = [];
  const scope = {
    needsSignIn: false,
    heldCheckout: { sellerIds: ["seller"], sessionIds: ["cs_1"] },
    setError() {},
    setPendingQuantities() {},
    setHeldCheckout: (value) => calls.push(["setHeld", value]),
    rollbackCheckoutSessions: async (ids) => calls.push(["rollback", ids]),
    fetch: async (url) => {
      calls.push(["update", url]);
      return { ok: true, json: async () => ({}) };
    },
    load: async () => {},
    notifyCartUpdated() {},
    clearCartSessionStorage() {},
    setSelectedRates() {},
    setClientSecrets() {},
    setCurrentPaymentIndex() {},
    clearCompletedCheckoutSessions() {},
  };
  const names = Object.keys(scope);
  const setQuantity = new Function(...names, `${compile(cartPageFunction("setQuantity"))}; return setQuantity;`)(
    ...names.map((name) => scope[name]),
  );
  assert.equal(await setQuantity("line", 0), true);
  assert.deepEqual(calls[0], ["rollback", ["cs_1"]]);
  assert.deepEqual(calls[1], ["setHeld", null]);
  assert.deepEqual(calls[2], ["update", "/api/cart/update"]);
});

test("a finished checkout replaces the payment step, so Back can leave the receipt", async () => {
  const navigation = [];
  const scope = {
    setResumingCheckout() {},
    setError() {},
    setNeedsSignIn() {},
    clearCartSessionStorage() {},
    setShippingAddress() {},
    setClientSecrets() {},
    setCurrentPaymentIndex() {},
    clearCartGiftNotes() {},
    setCompletedSessionIds() {},
    setStep() {},
    router: {
      push: (url) => navigation.push(["push", url]),
      replace: (url) => navigation.push(["replace", url]),
    },
    fetch: async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        shippingAddress: { line1: "1 Main" },
        clientSecrets: [],
        completedSessionIds: ["cs_done"],
      }),
    }),
  };
  const names = Object.keys(scope);
  const resume = new Function(
    ...names,
    `${compile(cartPageFunction("resumeOpenCartCheckout"))}; return resumeOpenCartCheckout;`,
  )(...names.map((name) => scope[name]));
  assert.equal(await resume(new AbortController().signal), true);
  assert.deepEqual(navigation, [
    ["replace", "/checkout/success?session_id=cs_done&session_ids=cs_done"],
  ]);
});
