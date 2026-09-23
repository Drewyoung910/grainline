import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { expireClosedSellerAccountSessions } from "../src/lib/orderSellerClosureSessions.ts";

const scope = { sellerId: "seller-1", accountId: "acct_closed", nowSeconds: 2_000_000_000 };
const session = (id, status = "open", account = "acct_closed", seller = "seller-1") => ({
  id, status, metadata: { sellerId: seller, ...(account ? { sellerStripeAccountId: account } : {}) },
});
function harness(initial) {
  const rows = new Map(initial.map((s) => [s.id, s]));
  const calls = { list: [], expire: [], retrieve: [], restore: [] };
  const deps = {
    list: async (params) => {
      calls.list.push(params);
      return { data: [...rows.values()], has_more: false };
    },
    expire: async (id) => {
      calls.expire.push(id);
      const expired = { ...rows.get(id), status: "expired" };
      rows.set(id, expired);
      return expired;
    },
    retrieve: async (id) => { calls.retrieve.push(id); return rows.get(id); },
    restore: async (s) => { calls.restore.push(s.id); },
  };
  return { rows, calls, deps };
}

test("old-account closure never expires replacement-account or other-seller checkout", async () => {
  const h = harness([
    session("cs_old"), session("cs_replacement", "open", "acct_new"),
    session("cs_other", "open", "acct_closed", "seller-2"), session("cs_paid", "complete"),
  ]);
  assert.deepEqual(await expireClosedSellerAccountSessions(scope, h.deps), { checked: 1, expired: 1, restored: 1 });
  assert.deepEqual(h.calls.expire, ["cs_old"]);
  assert.deepEqual(h.calls.restore, ["cs_old"]);
  assert.equal(h.rows.get("cs_replacement").status, "open");
});

test("provider listing failure propagates with no false successful completion", async () => {
  const h = harness([session("cs_old")]);
  h.deps.list = async () => { throw new Error("list offline"); };
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /list offline/);
  assert.deepEqual(h.calls.expire, []);
});

test("failed stock restoration replays an already-expired session without expiring again", async () => {
  const h = harness([session("cs_old")]);
  h.deps.restore = async () => { throw new Error("database unavailable"); };
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /database unavailable/);
  assert.equal(h.rows.get("cs_old").status, "expired");
  h.deps.restore = async (s) => { h.calls.restore.push(s.id); };
  await expireClosedSellerAccountSessions(scope, h.deps);
  assert.deepEqual(h.calls.expire, ["cs_old"]);
  assert.deepEqual(h.calls.restore, ["cs_old"]);
  assert.equal(h.calls.list[1].status, undefined, "retry must include expired sessions");
});

test("ambiguous successful expiry is reconciled by retrieving the exact session", async () => {
  const h = harness([session("cs_old")]);
  h.deps.expire = async (id) => { h.rows.set(id, session(id, "expired")); throw new Error("lost response"); };
  await expireClosedSellerAccountSessions(scope, h.deps);
  assert.deepEqual(h.calls.retrieve, ["cs_old"]);
  assert.deepEqual(h.calls.restore, ["cs_old"]);
});

test("failed expiry that remains open rejects and retries only unresolved work", async () => {
  const h = harness([session("cs_first"), session("cs_second")]);
  const expire = h.deps.expire;
  h.deps.expire = async (id) => {
    if (id === "cs_second") throw new Error("expiry offline");
    return expire(id);
  };
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /expiry offline/);
  assert.deepEqual(h.calls.restore, ["cs_first"]);
  h.deps.expire = expire;
  await expireClosedSellerAccountSessions(scope, h.deps);
  assert.deepEqual(h.calls.expire, ["cs_first", "cs_second"]);
  assert.deepEqual(h.calls.restore, ["cs_first", "cs_first", "cs_second"]);
});

test("payment winning the expiry race never triggers stock restoration", async () => {
  const h = harness([session("cs_paid")]);
  h.deps.expire = async (id) => { h.rows.set(id, session(id, "complete")); throw new Error("already paid"); };
  await expireClosedSellerAccountSessions(scope, h.deps);
  assert.deepEqual(h.calls.restore, []);
});

test("reconciliation retrieval failure and nonterminal expiry response remain retryable", async () => {
  const h = harness([session("cs_old")]);
  h.deps.expire = async () => { throw new Error("expiry transport failed"); };
  h.deps.retrieve = async () => { throw new Error("retrieve offline"); };
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /retrieve offline/);
  h.deps.expire = async () => session("cs_old");
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /unresolved/);
  assert.deepEqual(h.calls.restore, []);
});

test("provider response identity drift rejects before any stock restoration", async () => {
  for (const drift of [session("cs_other", "expired"), session("cs_old", "expired", "acct_new"), session("cs_old", "expired", "acct_closed", "seller-2")]) {
    const h = harness([session("cs_old")]);
    h.deps.expire = async () => drift;
    await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /identity changed/);
    assert.deepEqual(h.calls.restore, []);
  }
});

test("unbound payable predecessor sessions stay untouched and keep delivery retryable", async () => {
  const h = harness([session("cs_legacy", "open", null)]);
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /without account binding/);
  assert.deepEqual(h.calls.expire, []);
  h.rows.set("cs_legacy", session("cs_legacy", "expired", null));
  await expireClosedSellerAccountSessions(scope, h.deps);
  assert.deepEqual(h.calls.restore, [], "legacy expired reservations stay with the existing repair worker");
});

test("pagination follows the exact cursor and preserves the bounded query window", async () => {
  const h = harness([]);
  h.deps.list = async (params) => {
    h.calls.list.push(params);
    return params.starting_after
      ? { data: [session("cs_second", "expired")], has_more: false }
      : { data: [session("cs_first", "expired")], has_more: true };
  };
  await expireClosedSellerAccountSessions(scope, h.deps);
  assert.deepEqual(h.calls.restore, ["cs_first", "cs_second"]);
  assert.deepEqual(h.calls.list, [
    { created: { gte: scope.nowSeconds - 7200 }, limit: 100 },
    { created: { gte: scope.nowSeconds - 7200 }, limit: 100, starting_after: "cs_first" },
  ]);
});

test("page-budget exhaustion, empty continuation, and repeated cursors cannot claim completion", async () => {
  const h = harness([]);
  let pages = 0;
  h.deps.list = async () => ({ data: [session(`cs_page${++pages}`, "complete")], has_more: true });
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /page budget exhausted/);
  assert.equal(pages, 10);
  h.deps.list = async () => ({ data: [], has_more: true });
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /pagination is incomplete/);
  h.deps.list = async () => ({ data: [session("cs_same", "complete")], has_more: true });
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /did not advance/);
});

test("invalid scope and unresolved provider status fail closed", async () => {
  const h = harness([session("cs_bad", null)]);
  await assert.rejects(expireClosedSellerAccountSessions({ ...scope, accountId: "app_wrong" }, h.deps), /Invalid/);
  assert.deepEqual(h.calls.list, []);
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /unresolved/);
});

test("missing page completion evidence and oversized pages fail closed", async () => {
  const h = harness([]);
  h.deps.list = async () => ({ data: [] });
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /page is invalid/);
  h.deps.list = async () => ({ data: Array.from({ length: 101 }, (_, i) => session(`cs_${i}`)), has_more: false });
  await assert.rejects(expireClosedSellerAccountSessions(scope, h.deps), /page is invalid/);
  assert.deepEqual(h.calls.expire, []);
});

test("real adapters preserve the destination witness and throwing completion boundary", () => {
  const read = (path) => readFileSync(path, "utf8");
  const single = read("src/app/api/cart/checkout/single/route.ts");
  const cart = read("src/app/api/cart/checkout-seller/route.ts");
  assert.match(single, /const checkoutMetadata[^=]*= \{[\s\S]*sellerStripeAccountId,/);
  assert.match(single, /destination: sellerStripeAccountId/);
  assert.match(cart, /const checkoutMetadata[^=]*= \{[\s\S]*sellerStripeAccountId: destination,/);
  assert.match(cart, /transfer_data: \{\s*destination,/);
  const adapter = read("src/lib/checkoutSessionExpiry.ts").split("async function checkoutSessionBelongsToSeller")[0];
  assert.match(adapter, /expireClosedSellerAccountSessions<Stripe.Checkout.Session>/);
  assert.match(adapter, /restore: async \(session\) => restoreSellerExpiredCheckoutStockOnce/);
  assert.doesNotMatch(adapter, /\.catch\(/);
  const route = read("src/app/api/stripe/webhook/v2/route.ts");
  assert.match(route, /await expireCheckoutSessionsForClosedAccount\(\{/);
  assert.match(route, /const response = await handler\(\);\s*await markStripeWebhookEventProcessed/);
  assert.match(route, /await markCurrentStripeWebhookEventFailed\(handlerErr\);\s*throw handlerErr/);
});
