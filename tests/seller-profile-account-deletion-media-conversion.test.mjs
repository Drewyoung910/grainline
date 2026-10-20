import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020150000_prepare_seller_profile_account_deletion_media/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerAccountDeletionMediaAccess.ts", "utf8");
const deletion = readFileSync("src/lib/accountDeletion.ts", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("seller account-deletion media is derived from the active fenced claim", () => {
  assert.match(migration, /grainline_account_deletion_claim_user\(/u);
  assert.match(migration, /JOIN public\."Listing"/u);
  assert.match(migration, /JOIN public\."Photo"/u);
  assert.match(migration, /"originalUrl"/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/u);
  assert.match(access, /grainline_seller_account_deletion_public_media_urls/u);
  assert.match(deletion, /sellerAccountDeletionPublicMediaUrls\(db, \{/u);
  assert.doesNotMatch(deletion, /db\.sellerProfile\./u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_account_deletion_public_media_urls/g)].length,
    2,
    "runtime-role reprovisioning must revoke then restore only the reviewed EXECUTE grant",
  );
});
