import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261028050000_activate_favorite_rls/migration.sql",
  "utf8",
);
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
});

test("runtime provisioning converges Favorite to the exact activated grant set", () => {
  assert.match(provisioning, /favorite_owner_select/u);
  assert.match(provisioning, /favorite_owner_delete/u);
  assert.match(
    provisioning,
    /GRANT SELECT, DELETE ON TABLE public\."Favorite"\s+TO :"runtime_role"/u,
  );
});
