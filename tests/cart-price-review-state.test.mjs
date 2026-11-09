import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cartPriceReviewState } from "../src/lib/cartPriceReviewState.ts";

test("checkout preserves a changed cart price for explicit buyer review", () => {
  assert.deepEqual(
    cartPriceReviewState({
      oldPriceCents: 10_000,
      newPriceCents: 11_500,
      oldPriceVersion: 3,
      newPriceVersion: 4,
    }),
    {
      oldPriceCents: 10_000,
      newPriceCents: 11_500,
      oldPriceVersion: 3,
      newPriceVersion: 4,
    },
  );
});

test("a version-only change still requires explicit review", () => {
  assert.deepEqual(
    cartPriceReviewState({
      oldPriceCents: 10_000,
      newPriceCents: 10_000,
      oldPriceVersion: 3,
      newPriceVersion: 4,
    }),
    {
      oldPriceCents: 10_000,
      newPriceCents: 10_000,
      oldPriceVersion: 3,
      newPriceVersion: 4,
    },
  );
});

test("an unchanged cart line can continue to payment", () => {
  assert.equal(
    cartPriceReviewState({
      oldPriceCents: 10_000,
      newPriceCents: 10_000,
      oldPriceVersion: 4,
      newPriceVersion: 4,
    }),
    null,
  );
});

test("the checkout route does not accept a changed price on the buyer's behalf", () => {
  const route = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
  assert.match(route, /const priceReview = cartPriceReviewState\(\{/);
  assert.doesNotMatch(route, /updateOwnerCartItemPrice/);
});
