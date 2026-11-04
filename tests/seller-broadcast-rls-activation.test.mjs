import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  process.env.SELLER_BROADCAST_RLS_ACTIVATION_MIGRATION_PATH?.trim()
  || "prisma/migrations/20261101050000_activate_seller_broadcast_rls/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(
  "docs/rls-drafts/seller-broadcast-activation-rollback.sql",
  "utf8",
);
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("SellerBroadcast activation removes all direct runtime table authority", () => {
  assert.match(
    migration,
    /LOCK TABLE public\."SellerBroadcast" IN ACCESS EXCLUSIVE MODE/u,
  );
  assert.match(
    migration,
    /ALTER TABLE public\."SellerBroadcast" ENABLE ROW LEVEL SECURITY/u,
  );
  assert.match(
    migration,
    /ALTER TABLE public\."SellerBroadcast" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\."SellerBroadcast"\s+FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(
    migration,
    /GRANT\s+[^;]*ON TABLE public\."SellerBroadcast"/iu,
  );
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("SellerBroadcast activation pins the exact table, reader, and trigger envelope", () => {
  assert.match(migration, /SellerBroadcast columns drifted/u);
  assert.match(migration, /SellerBroadcast constraints drifted/u);
  assert.match(migration, /SellerBroadcast indexes drifted/u);
  assert.match(migration, /grainline_direct_upload_release_seller_broadcast_delete:11/u);
  assert.match(migration, /SellerBroadcast has an unreviewed function reader/u);
  for (const name of [
    "grainline_seller_broadcast_owner_create",
    "grainline_seller_broadcast_public_latest",
    "grainline_seller_broadcast_actor_feed_page",
    "grainline_seller_broadcast_staff_delete",
    "grainline_seller_broadcast_account_deletion_cleanup",
    "grainline_notification_create_core",
    "grainline_notification_delete_seller_broadcast",
    "grainline_direct_upload_sync_seller_broadcast",
    "grainline_email_outbox_source_owner",
    "grainline_email_outbox_begin_provider_attempt",
    "grainline_seller_staff_broadcast_targets",
  ]) {
    assert.match(migration, new RegExp(`public\\.${name}\\(`, "u"));
  }
});

test("SellerBroadcast rollback restores compatible CRUD before disabling RLS", () => {
  const grant = rollback.indexOf(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SellerBroadcast"',
  );
  const noForce = rollback.indexOf(
    'ALTER TABLE public."SellerBroadcast" NO FORCE ROW LEVEL SECURITY',
  );
  const disable = rollback.indexOf(
    'ALTER TABLE public."SellerBroadcast" DISABLE ROW LEVEL SECURITY',
  );
  assert.equal(grant >= 0, true);
  assert.equal(grant < noForce, true);
  assert.equal(noForce < disable, true);
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.match(rollback, /new reviewed forward migration with a new name/u);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("runtime provisioning recognizes only predecessor or exact policyless activation", () => {
  assert.match(
    provisioning,
    /SellerBroadcast RLS is partially or unexpectedly configured; refusing runtime-role provisioning/u,
  );
  assert.match(
    provisioning,
    /REVOKE ALL ON TABLE public\."SellerBroadcast" FROM PUBLIC, :"runtime_role"/u,
  );
});
