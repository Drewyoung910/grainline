import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261015000000_correct_seller_profile_private_app_authorities"),
  "utf8",
);
const accountDeletionWorker = readFileSync("src/lib/accountDeletionSideEffects.ts", "utf8");
const sellerCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");

test("SellerProfile app-authority hotfix preserves exact role boundaries", () => {
  assert.match(migration, /^BEGIN;/mu);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /ALTER TABLE|ROW LEVEL SECURITY/iu);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_guild_staff_roster\(text, text\)/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_guild_staff_transition\(\s*text, text, text, text, text, boolean\s*\)/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_account_deletion_reconciliation_clear\(\s*text, text, text, bigint, uuid\s*\)/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_staff_orderability_state\(text, text\)/u);
  assert.match(migration, /grainline_seller_guild_staff_roster\(text, text\)[\s\S]*TO grainline_staff_read_runtime/u);
  assert.match(migration, /grainline_seller_guild_staff_transition\([\s\S]*TO grainline_staff_read_runtime/u);
  assert.match(migration, /grainline_seller_account_deletion_reconciliation_clear\([\s\S]*TO grainline_app_runtime/u);
  assert.match(migration, /grainline_seller_staff_orderability_state\(text, text\)[\s\S]*TO grainline_staff_read_runtime/u);
});

test("SellerProfile app-authority hotfix closes the four reproduced SQL defects", () => {
  assert.match(migration, /OR p_cohort IS NULL/u);
  assert.match(migration, /OR p_operation IS NULL/u);
  assert.equal((migration.match(/audit_reason := pg_catalog\.left\(p_review_notes, 500\);/gu) ?? []).length, 2);
  assert.match(migration, /seller_private\."stripeAccountId"::text/u);
  assert.doesNotMatch(
    migration,
    /WHERE seller\."userId" = p_user_id\s+AND seller_private\."stripeAccountId" = p_stripe_account_id/u,
  );
  assert.match(
    migration,
    /Account deletion could not reject Stripe Connect account ' \|\| p_stripe_account_id/u,
  );
});

test("account-deletion reconciliation misses are observable", () => {
  assert.match(accountDeletionWorker, /const cleared = await clearSellerAccountDeletionReconciliation/u);
  assert.match(
    accountDeletionWorker,
    /if \(!cleared\)[\s\S]*Account deletion Stripe reconciliation state was not cleared/u,
  );
});

test("cart stock and quantity validation precede the private seller projection", () => {
  const madeToOrder = sellerCheckout.indexOf('item.listing.listingType === "MADE_TO_ORDER"');
  const outOfStock = sellerCheckout.indexOf('is currently out of stock');
  const privateProjection = sellerCheckout.indexOf("const checkoutPrivateState = await sellerCheckoutPrivateState");
  assert.ok(madeToOrder >= 0 && madeToOrder < privateProjection);
  assert.ok(outOfStock >= 0 && outOfStock < privateProjection);
  assert.equal(sellerCheckout.indexOf('item.listing.listingType === "MADE_TO_ORDER"', madeToOrder + 1), -1);
});
