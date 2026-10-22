import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020050000_prepare_seller_profile_customer_photo_header/migration.sql";
const page = readFileSync("src/app/seller/[id]/customer-photos/page.tsx", "utf8");

test("customer-photo page uses its bounded seller header authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync("src/lib/sellerProfilePublicAccess.ts", "utf8");

  assert.match(migration, /grainline_seller_public_customer_photo_header\(text\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /public\."Block"/u);
  assert.match(helper, /export async function sellerPublicCustomerPhotoHeader/u);
  assert.match(page, /sellerPublicCustomerPhotoHeader\(meId, sellerId\)/u);
  assert.doesNotMatch(page, /prisma\.sellerProfile|publicListingDetailWhere/u);
  assert.match(page, /sellerPublicCustomerPhotoHeader\(meId, sellerId\)[\s\S]*photos[\s\S]*sellerPublicCustomerPhotoHeader\(meId, sellerId\)/u);
});
