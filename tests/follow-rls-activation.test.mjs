import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261028060000_activate_follow_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/follow-activation-rollback.sql",
  "utf8",
);
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("Follow activation removes all direct runtime table authority", () => {
  assert.match(migration, /LOCK TABLE public\."Follow" IN ACCESS EXCLUSIVE MODE/u);
  assert.match(migration, /ALTER TABLE public\."Follow" ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\."Follow" FORCE ROW LEVEL SECURITY/u);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\."Follow"\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(migration, /GRANT\s+[^;]*ON TABLE public\."Follow"/iu);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("Follow activation pins every installed cross-domain reader", () => {
  for (const identity of [
    "grainline_follow_account_deletion_cleanup",
    "grainline_follow_owner_outgoing_count",
    "grainline_follow_owner_target_ids",
    "grainline_follow_public_state_batch",
    "grainline_follow_seller_owner_incoming_count",
    "grainline_notification_create_core",
    "grainline_seller_actor_account_feed_cards",
    "grainline_seller_owner_follow_export",
    "grainline_seller_owner_following_count",
    "grainline_seller_owner_following_page",
    "grainline_seller_public_follow_create",
    "grainline_seller_public_follow_delete",
    "grainline_seller_public_follow_state",
    "grainline_seller_public_metro_makers",
    "grainline_seller_public_similar_makers",
    "grainline_user_block_follow_cleanup",
    "grainline_user_follower_notification_page",
    "grainline_user_owner_broadcast_follower_page",
  ]) {
    assert.match(migration, new RegExp(`public\\.${identity}\\(`, "u"));
  }
  assert.match(migration, /Follow has an unreviewed function reader/u);
  assert.match(
    migration,
    /Follow has an unreviewed function reader after activation/u,
  );
  assert.equal(
    (migration.match(/pg_catalog\.md5\(procedure\.prosrc\)/gu) ?? []).length,
    2,
  );
});

test("Follow rollback restores compatible CRUD before disabling RLS", () => {
  const grantIndex = rollback.indexOf(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Follow"',
  );
  const noForceIndex = rollback.indexOf(
    'ALTER TABLE public."Follow" NO FORCE ROW LEVEL SECURITY',
  );
  const disableIndex = rollback.indexOf(
    'ALTER TABLE public."Follow" DISABLE ROW LEVEL SECURITY',
  );
  assert.equal(grantIndex >= 0, true);
  assert.equal(grantIndex < noForceIndex, true);
  assert.equal(noForceIndex < disableIndex, true);
  assert.equal((rollback.match(/\bDROP POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
  assert.match(rollback, /migrate resolve --rolled-back 20261028060000_activate_follow_rls/u);
});

test("runtime provisioning preserves policyless Follow activation", () => {
  assert.match(
    provisioning,
    /Follow RLS is partially or unexpectedly configured; refusing runtime-role provisioning/u,
  );
  assert.match(
    provisioning,
    /REVOKE ALL ON TABLE public\."Follow" FROM PUBLIC, :"runtime_role"/u,
  );
});
