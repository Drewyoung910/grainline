import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  process.env.REVIEW_VOTE_RLS_ACTIVATION_MIGRATION_PATH?.trim() ||
  "prisma/migrations/20261028070000_activate_review_vote_rls/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const rollback = readFileSync(
  "docs/rls-drafts/review-vote-activation-rollback.sql",
  "utf8",
);
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("ReviewVote activation retains only owner SELECT and fixed mutations", () => {
  assert.match(migration, /LOCK TABLE public\."ReviewVote" IN ACCESS EXCLUSIVE MODE/u);
  assert.doesNotMatch(migration, /LOCK TABLE public\."Review" IN ACCESS EXCLUSIVE MODE/u);
  assert.match(migration, /CREATE POLICY review_vote_owner_select/u);
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 1);
  assert.match(
    migration,
    /GRANT SELECT ON TABLE public\."ReviewVote"\s+TO grainline_app_runtime/u,
  );
  assert.doesNotMatch(
    migration,
    /GRANT (?:INSERT|UPDATE|DELETE|SELECT,)[^;]*ON TABLE public\."ReviewVote"/u,
  );
  assert.match(migration, /ALTER TABLE public\."ReviewVote" ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\."ReviewVote" FORCE ROW LEVEL SECURITY/u);
  assert.match(migration, /CREATE TRIGGER "ReviewVote_count_after_delete"/u);
  assert.match(migration, /grainline_review_vote_count_after_delete/u);
  assert.match(migration, /REFERENCING OLD TABLE AS deleted_review_votes/u);
  assert.match(migration, /FOR EACH STATEMENT EXECUTE FUNCTION/u);
  assert.match(migration, /ORDER BY review\.id\s+FOR UPDATE/u);
  assert.match(migration, /procedure\.prosrc = \$grainline_review_vote_count_expected\$/u);
  assert.match(migration, /\(owner\.rolsuper OR owner\.rolbypassrls\)/u);
  for (const sourceHash of [
    "f6c529e56b59735d36d7c78e1bcf45bc",
    "30d3d3cb1d88e9206970c2f9f103e367",
    "0e9153d1ddabac3e1542970bf6147583",
    "f655fe4f4f6ef26db9588db34e9aece4",
    "e0f3bcc6143107e6609cf3fe4a209410",
  ]) {
    assert.match(migration, new RegExp(sourceHash, "u"));
  }
  assert.match(migration, /ReviewVote has an unreviewed function reader/u);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN)/iu);
});

test("ReviewVote rollback removes activation-only maintenance before restoring CRUD", () => {
  const dropTriggerAt = rollback.indexOf(
    'DROP TRIGGER "ReviewVote_count_after_delete" ON public."ReviewVote"',
  );
  const restoreCrudAt = rollback.indexOf(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ReviewVote"',
  );
  assert.ok(dropTriggerAt >= 0 && dropTriggerAt < restoreCrudAt);
  assert.match(rollback, /DROP FUNCTION public\.grainline_review_vote_count_after_delete\(\)/u);
  assert.match(rollback, /procedure\.prosrc = \$grainline_review_vote_count_expected\$/u);
  assert.match(rollback, /tgfoid = pg_catalog\.to_regprocedure/u);
  assert.match(rollback, /ALTER TABLE public\."ReviewVote" NO FORCE ROW LEVEL SECURITY/u);
  assert.match(rollback, /ALTER TABLE public\."ReviewVote" DISABLE ROW LEVEL SECURITY/u);
  assert.match(rollback, /DROP POLICY review_vote_owner_select/u);
  assert.match(rollback, /migrate resolve --rolled-back 20261028070000_activate_review_vote_rls/u);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN)/iu);
});

test("runtime provisioning rejects partial ReviewVote activation and converges grants", () => {
  assert.match(provisioning, /review_vote_owner_select/u);
  assert.match(
    provisioning,
    /ReviewVote RLS is partially or unexpectedly configured; refusing runtime-role provisioning[\s\S]*WHERE active IS DISTINCT FROM true[\s\S]*AND clean_predecessor IS DISTINCT FROM true/u,
  );
  assert.match(
    provisioning,
    /GRANT SELECT ON TABLE public\."ReviewVote"\s+TO :"runtime_role"/u,
  );
  assert.match(provisioning, /grainline_review_vote_count_after_delete/u);
});
