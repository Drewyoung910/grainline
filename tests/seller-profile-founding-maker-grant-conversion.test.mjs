import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020060000_prepare_seller_profile_founding_maker_grant/migration.sql";

test("founding-maker allocation uses one bounded database authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const core = readFileSync("src/lib/foundingMakerCore.ts", "utf8");
  const repair = readFileSync("src/lib/foundingMaker.ts", "utf8");

  assert.match(migration, /grainline_seller_service_founding_maker_grant\(text\)/u);
  assert.match(migration, /pg_advisory_xact_lock\(913337, 250\)/u);
  assert.match(migration, /public\."FoundingMakerGrant"/u);
  assert.match(core, /grainline_seller_service_founding_maker_grant/u);
  assert.doesNotMatch(core, /sellerProfile\.(?:findUnique|updateMany)/u);
  assert.doesNotMatch(repair, /sellerProfile\.findUnique/u);
  assert.match(repair, /if \(await maybeGrantFoundingMaker\(sellerId\)\) repairedSellers \+= 1/u);
});
