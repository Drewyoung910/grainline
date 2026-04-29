import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { checkoutLockCanMarkReady, checkoutLockCanRelease } = await import("../src/lib/checkoutLockState.ts");

describe("checkout lock state guards", () => {
  it("only marks preparing locks with the same payload hash as ready", () => {
    assert.equal(
      checkoutLockCanMarkReady({ state: "preparing", payloadHash: "hash-a", createdAt: 1 }, "hash-a"),
      true,
    );
    assert.equal(
      checkoutLockCanMarkReady({ state: "preparing", payloadHash: "hash-a", createdAt: 1 }, "hash-b"),
      false,
    );
    assert.equal(
      checkoutLockCanMarkReady({ state: "ready", payloadHash: "hash-a", createdAt: 1, sessionId: "cs_1" }, "hash-a"),
      false,
    );
    assert.equal(checkoutLockCanMarkReady(null, "hash-a"), false);
  });

  it("only releases session-bound locks for the matching Stripe session", () => {
    const readyLock = {
      state: "ready",
      payloadHash: "hash-a",
      createdAt: 1,
      sessionId: "cs_expected",
      clientSecret: "secret",
    };

    assert.equal(checkoutLockCanRelease(readyLock, "cs_expected"), true);
    assert.equal(checkoutLockCanRelease(readyLock, "cs_other"), false);
    assert.equal(checkoutLockCanRelease({ state: "preparing", payloadHash: "hash-b", createdAt: 1 }, "cs_expected"), false);
  });

  it("keeps manual releases available for pre-session failure cleanup", () => {
    assert.equal(checkoutLockCanRelease(null), true);
    assert.equal(checkoutLockCanRelease({ state: "preparing", payloadHash: "hash-a", createdAt: 1 }), true);
  });
});
