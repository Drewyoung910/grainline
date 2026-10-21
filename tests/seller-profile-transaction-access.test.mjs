import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(path, "utf8");

const migration = source(
  "prisma/migrations/20261021000000_prepare_seller_profile_transaction_states/migration.sql",
);
const access = source("src/lib/sellerTransactionAccess.ts");
const cartAccess = source("src/lib/cartOwnerAccess.ts");
const cartAdd = source("src/app/api/cart/add/route.ts");
const cartUpdate = source("src/app/api/cart/update/route.ts");
const shippingQuote = source("src/app/api/shipping/quote/route.ts");
const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
const singleResume = source("src/app/api/cart/checkout/single/resume/route.ts");

test("transaction seller projections are actor-, listing-, and cart-bound", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /actor\.id = actor_id[\s\S]*actor\.banned = false[\s\S]*actor\."deletedAt" IS NULL/u);
  assert.match(migration, /listing\.id = p_listing_id/u);
  assert.match(migration, /cart\.id = p_cart_id[\s\S]*cart\."userId" = actor_id/u);
  assert.match(migration, /JOIN public\."SellerProfile" AS seller/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_actor_listing_transaction_state\(text\)[\s\S]*FROM PUBLIC, grainline_app_runtime/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_actor_cart_transaction_states\(text\)[\s\S]*FROM PUBLIC, grainline_app_runtime/u);
  assert.equal(
    (migration.match(/GRANT EXECUTE ON FUNCTION public\.grainline_seller_actor_(?:listing_transaction_state|cart_transaction_states)\(text\)[\s\S]*?TO grainline_app_runtime/gu) ?? []).length,
    2,
  );
});

test("cart, checkout, and shipping callers use the bounded transaction projections", () => {
  assert.match(access, /withDbUserContext/u);
  assert.match(access, /isolationLevel: "RepeatableRead"/u);
  assert.match(access, /grainline_seller_actor_listing_transaction_state/u);
  assert.match(access, /grainline_seller_actor_cart_transaction_states/u);
  assert.match(cartAccess, /withSellerActorCartTransaction/u);
  assert.match(cartAccess, /attachCartSellerStates/u);
  assert.match(cartAdd, /sellerListingTransactionSource\(me\.id, listingId\)/u);
  assert.match(cartUpdate, /sellerListingTransactionSource\(me\.id, item\.listingId\)/u);
  assert.match(shippingQuote, /sellerListingTransactionSource\(me\.id, body\.listingId \?\? ""\)/u);
  assert.match(singleCheckout, /sellerSingleCheckoutSource\(me\.id, body\.listingId\)/u);
  assert.match(singleResume, /sellerSingleCheckoutResumeSource\(me\.id, listingId\)/u);
});
