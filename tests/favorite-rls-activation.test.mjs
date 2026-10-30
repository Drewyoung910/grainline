import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  process.env.FAVORITE_RLS_ACTIVATION_MIGRATION_PATH?.trim() ||
  "prisma/migrations/20261028050000_activate_favorite_rls/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(
  "docs/rls-drafts/favorite-activation-rollback.sql",
  "utf8",
);
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("Favorite activation keeps guarded add as the only runtime insert boundary", () => {
  assert.match(migration, /LOCK TABLE public\."Favorite" IN ACCESS EXCLUSIVE MODE/u);
  assert.doesNotMatch(migration, /LOCK TABLE public\."Listing"/u);
  assert.match(migration, /ALTER TABLE public\."Favorite" ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\."Favorite" FORCE ROW LEVEL SECURITY/u);
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 2);
  assert.match(migration, /CREATE POLICY favorite_owner_select/u);
  assert.match(migration, /CREATE POLICY favorite_owner_delete/u);
  assert.match(
    migration,
    /GRANT SELECT, DELETE ON TABLE public\."Favorite"\s+TO grainline_app_runtime/u,
  );
  assert.doesNotMatch(
    migration,
    /GRANT (?:INSERT|UPDATE|SELECT, INSERT|SELECT, UPDATE)[^;]*ON TABLE public\."Favorite"/u,
  );
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)/iu);
  assert.doesNotMatch(migration, /grainline_favorite_block_cleanup/u);
  assert.match(migration, /Listing_favoriteCount_guard/u);
  assert.match(migration, /grainline_listing_favorite_count_guard/u);
  assert.match(migration, /trigger_state\.tgattr::smallint\[\][\s\S]*ARRAY\['favoriteCount'\]::text\[\]/u);
  assert.match(migration, /d8085ac26793b1bdbcaab3694de9842c/u);
  assert.match(migration, /AND NOT procedure\.prosecdef/u);
  for (const identity of [
    "grainline_notification_create_core",
    "grainline_order_seller_analytics_top_listings",
    "grainline_seller_owner_saved_listing_count",
    "grainline_seller_owner_saved_listing_page",
    "grainline_user_public_listing_favorite_counts",
  ]) {
    assert.match(migration, new RegExp(identity, "u"));
  }
  assert.match(migration, /Favorite has an unreviewed function reader/u);
});

test("Favorite rollback restores the compatible predecessor without deleting preparation", () => {
  assert.match(rollback, /LOCK TABLE public\."Favorite" IN ACCESS EXCLUSIVE MODE/u);
  assert.doesNotMatch(rollback, /LOCK TABLE public\."Listing"/u);
  assert.match(rollback, /ALTER TABLE public\."Favorite" NO FORCE ROW LEVEL SECURITY/u);
  assert.match(rollback, /ALTER TABLE public\."Favorite" DISABLE ROW LEVEL SECURITY/u);
  assert.match(
    rollback,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\."Favorite"\s+TO grainline_app_runtime/u,
  );
  assert.equal((rollback.match(/\bDROP POLICY\b/gu) ?? []).length, 2);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
  assert.match(
    rollback,
    /migrate resolve --rolled-back 20261028050000_activate_favorite_rls/u,
  );
});

test("runtime provisioning converges Favorite to the exact activated grant set", () => {
  assert.match(provisioning, /favorite_owner_select/u);
  assert.match(provisioning, /favorite_owner_delete/u);
  assert.match(
    provisioning,
    /Favorite RLS is partially or unexpectedly configured; refusing runtime-role provisioning[\s\S]*WHERE active IS DISTINCT FROM true[\s\S]*AND clean_predecessor IS DISTINCT FROM true/u,
  );
  assert.match(
    provisioning,
    /GRANT SELECT, DELETE ON TABLE public\."Favorite"\s+TO :"runtime_role"/u,
  );
});
