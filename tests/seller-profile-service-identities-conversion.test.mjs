import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020080000_prepare_seller_profile_service_identities/migration.sql";

test("service identity lookups use two bounded SellerProfile authorities", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const webhook = readFileSync("src/app/api/clerk/webhook/route.ts", "utf8");
  const expiry = readFileSync("src/lib/checkoutSessionExpiry.ts", "utf8");

  assert.match(migration, /grainline_seller_service_welcome_name\(text\)/u);
  assert.match(
    migration,
    /grainline_seller_transaction_blocked_pair_targets\(text,text\)/u,
  );
  assert.doesNotMatch(webhook, /sellerProfile\.findUnique/u);
  assert.doesNotMatch(expiry, /sellerProfile\.findMany/u);
});
