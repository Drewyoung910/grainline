import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  CHECKOUT_SUCCESS_SESSION_LIMIT,
  checkoutSuccessParams,
  checkoutSuccessSessionIds,
} = await import("../src/lib/checkoutSuccessState.ts");

const checkoutSuccessSource = fs.readFileSync(
  new URL("../src/app/checkout/success/page.tsx", import.meta.url),
  "utf8",
);

describe("checkout success session parsing", () => {
  it("survives a repeated session parameter instead of returning a 500", () => {
    assert.deepEqual(
      checkoutSuccessSessionIds(checkoutSuccessParams({
        session_id: ["cs_first", "cs_second"],
        session_ids: ["cs_first,cs_third", "cs_fourth"],
      })),
      { sessionIds: ["cs_first", "cs_third", "cs_fourth"], truncatedCount: 0 },
    );
    assert.deepEqual(checkoutSuccessParams({ session_id: "cs_one" }), { sessionId: "cs_one", sessionIds: undefined });
    assert.deepEqual(checkoutSuccessParams(null), { sessionId: undefined, sessionIds: undefined });
  });

  it("drops session ids with characters Stripe never uses, such as NUL", () => {
    assert.deepEqual(
      checkoutSuccessSessionIds({
        sessionId: "cs_test_a1B2",
        sessionIds: "cs_\u0000,cs_bad id,cs_test_a1B2,cs_live_c3",
      }),
      { sessionIds: ["cs_test_a1B2", "cs_live_c3"], truncatedCount: 0 },
    );
  });

  it("dedupes comma-separated checkout session ids while preserving order", () => {
    assert.deepEqual(
      checkoutSuccessSessionIds({
        sessionId: "cs_last",
        sessionIds: "cs_first,not-a-session, cs_last, cs_second",
      }),
      {
        sessionIds: ["cs_first", "cs_last", "cs_second"],
        truncatedCount: 0,
      },
    );
  });

  it("does not silently truncate legitimate carts after ten sessions", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `cs_${index}`);
    assert.deepEqual(
      checkoutSuccessSessionIds({
        sessionId: ids[11],
        sessionIds: ids.slice(0, 11).join(","),
      }),
      {
        sessionIds: ids,
        truncatedCount: 0,
      },
    );
  });

  it("returns a truncation count only past the explicit receipt limit", () => {
    const ids = Array.from({ length: CHECKOUT_SUCCESS_SESSION_LIMIT + 2 }, (_, index) => `cs_${index}`);
    const result = checkoutSuccessSessionIds({
      sessionId: ids.at(-1),
      sessionIds: ids.slice(0, -1).join(","),
    });

    assert.equal(result.sessionIds.length, CHECKOUT_SUCCESS_SESSION_LIMIT);
    assert.equal(result.truncatedCount, 2);
  });

  it("rejects overlong checkout session ids before the database boundary", () => {
    const overlongSessionId = `cs_${"x".repeat(253)}`;
    assert.deepEqual(
      checkoutSuccessSessionIds({
        sessionId: "cs_current",
        sessionIds: `${overlongSessionId},cs_prior`,
      }),
      {
        sessionIds: ["cs_prior", "cs_current"],
        truncatedCount: 0,
      },
    );
  });

  it("keeps the success page read-only after Stripe payment", () => {
    assert.doesNotMatch(checkoutSuccessSource, /\b(?:prisma|tx)\.order\.create\s*\(/);
    assert.doesNotMatch(checkoutSuccessSource, /prisma\.\$transaction/);
    assert.match(checkoutSuccessSource, /webhook is the only order writer/);
    assert.match(checkoutSuccessSource, /sessionMetadata\.buyerId/);
    assert.match(checkoutSuccessSource, /readBuyerCheckoutReceipts\(me\.id, sessionIds\)/);
    assert.match(checkoutSuccessSource, /readBuyerCheckoutReceipts\(me\.id, \[sessionId\]\)/);
    assert.doesNotMatch(checkoutSuccessSource, /\b(?:prisma|tx|client)\.order\b/);
  });
});
