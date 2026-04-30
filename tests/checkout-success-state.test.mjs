import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  CHECKOUT_SUCCESS_SESSION_LIMIT,
  checkoutSuccessSessionIds,
} = await import("../src/lib/checkoutSuccessState.ts");

describe("checkout success session parsing", () => {
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
});
