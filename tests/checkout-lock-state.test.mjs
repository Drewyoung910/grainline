import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { checkoutLockCanMarkReady, checkoutLockCanRelease } = await import("../src/lib/checkoutLockState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

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

  it("hashes checkout lock keys before Sentry telemetry", () => {
    for (const path of [
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
    ]) {
      const route = source(path);
      const captureStart = route.indexOf('Sentry.captureMessage("Checkout lock ready transition rejected"');
      assert.notEqual(captureStart, -1);
      const captureBlock = route.slice(
        captureStart,
        route.indexOf("});", captureStart),
      );

      assert.match(
        route,
        /import \{ hashIdentifierForTelemetry \} from "@\/lib\/privacyTelemetry"/,
      );
      assert.match(
        captureBlock,
        /checkoutLockKeyHash: hashIdentifierForTelemetry\(checkoutLockKeyValue\)/,
      );
      assert.doesNotMatch(captureBlock, /checkoutLockKey: checkoutLockKeyValue/);
    }
  });

  it("does not return live Stripe sessions after ready-transition errors", () => {
    for (const path of [
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
    ]) {
      const route = source(path);
      const catchStart = route.indexOf("} catch (lockErr) {");
      assert.notEqual(catchStart, -1);
      const catchEnd = route.indexOf("\n    }\n\n    return privateJson({ clientSecret", catchStart);
      assert.notEqual(catchEnd, -1);
      const catchBlock = route.slice(catchStart, catchEnd);

      assert.match(catchBlock, /stripe\.checkout\.sessions\.expire\(session\.id\)/);
      assert.match(catchBlock, /restoreUnorderedCheckoutStockOnce\(\{/);
      assert.match(catchBlock, /const sessionBoundLockReleased = await releaseCheckoutLock\(checkoutLockKeyValue, session\.id\)/);
      assert.match(catchBlock, /if \(!sessionBoundLockReleased\) \{\s*await releaseCheckoutLock\(checkoutLockKeyValue\);/s);
      assert.match(catchBlock, /status: HTTP_STATUS\.CONFLICT/);
      assert.doesNotMatch(catchBlock, /return privateJson\(\{ clientSecret: session\.client_secret, sessionId: session\.id \}\)/);
    }
  });
});
