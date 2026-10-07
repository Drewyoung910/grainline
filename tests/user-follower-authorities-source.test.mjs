import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const read = (path) => readFileSync(path, "utf8");
const migration = read(
  "prisma/migrations/20261007040000_prepare_user_follower_authorities/migration.sql",
);
const access = read("src/lib/userFollowerAccess.ts");

test("follower fanout uses bounded, purpose-specific authority operations", () => {
  assert.match(migration, /grainline_user_follower_notification_page\([\s\S]*p_limit integer/);
  assert.match(migration, /p_limit > 1000/);
  assert.match(migration, /follower\.banned = false/);
  assert.match(migration, /follower\."deletedAt" IS NULL/);
  assert.match(migration, /relationship\."followerId" <> seller\."userId"/);
  assert.match(migration, /blocked_pair\."blockerId" = relationship\."followerId"/);
  assert.match(migration, /blocked_pair\."blockedId" = seller\."userId"/);
  assert.match(migration, /ORDER BY relationship\.id/);
  assert.match(access, /const MAX_FOLLOWER_PAGE_SIZE = 1000/);
  assert.match(access, /afterFollowId/);
});

test("seller broadcast preference projection is authenticated-owner bound", () => {
  assert.match(migration, /grainline_user_owner_broadcast_follower_page/);
  assert.match(migration, /current_setting\('app\.user_id', true\)/);
  assert.match(migration, /seller\."userId" = request_user_id/);
  assert.match(migration, /follower\."notificationPreferences"/);
  assert.match(migration, /NOT p_sellers_only OR follower_seller\.id IS NOT NULL/);
  assert.match(access, /withDbUserContext\(userId/);
  assert.match(access, /const MAX_BROADCAST_AUDIENCE = 10000/);
  assert.match(access, /MAX_BROADCAST_AUDIENCE - followers\.length/);
});

test("quality score favorite counts are public aggregate only and bounded", () => {
  assert.match(migration, /grainline_user_public_listing_favorite_counts/);
  assert.match(migration, /pg_catalog\.cardinality\(p_listing_ids\) > 200/);
  assert.match(migration, /listing\.status = 'ACTIVE'/);
  assert.match(migration, /listing\."isPrivate" = false/);
  assert.match(migration, /pg_catalog\.count\(favoriter\.id\)::bigint/);
  assert.doesNotMatch(migration, /favoriter\.email|favoriter\.name|favoriter\."imageUrl"/);
  assert.match(access, /return new Map\(rows\.map/);
});

test("all three functions are fixed-path definers closed to PUBLIC", () => {
  assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 3);
  assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 3);
  assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 3);
  assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /EXECUTE\s+format|EXECUTE\s+[^\n]*\|\|/);
});

test("CI stages the follower authority after block-email and before build", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.doesNotThrow(() => yaml.load(workflow, { schema: yaml.JSON_SCHEMA }));
  const step = (name) => {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.ok(start >= 0, name);
    const next = workflow.indexOf("\n      - ", start + 1);
    return workflow.slice(start, next < 0 ? undefined : next);
  };
  const verify = workflow.indexOf("name: Verify User follower authority source package");
  const isolate = workflow.indexOf("name: Isolate User follower authority until block-email passes");
  const accumulatedRestore = workflow.indexOf("name: Restore accumulated User access source package");
  const blockApply = workflow.indexOf("name: Apply User block-email authorities in disposable PostgreSQL");
  const restore = workflow.indexOf("name: Restore User follower authority source package");
  const apply = workflow.indexOf("name: Apply User follower authorities in disposable PostgreSQL");
  const catalog = workflow.indexOf("name: Verify User follower authority catalog");
  const build = workflow.indexOf("name: Production build");
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < blockApply);
  assert.ok(isolate < accumulatedRestore && accumulatedRestore < blockApply);
  assert.ok(blockApply < restore);
  assert.ok(restore < apply && apply < catalog && catalog < build);

  const isolateBody = step("Isolate User follower authority until block-email passes");
  assert.match(isolateBody, /mv scripts\/user-authority-catalog\.mjs "\$holding\/user-authority-catalog-script"/);
  assert.match(isolateBody, /git show "\$historical:scripts\/user-authority-catalog\.mjs"/);
  const accumulatedRestoreBody = step("Restore accumulated User access source package");
  assert.match(accumulatedRestoreBody, /"\$follower_holding\/user-authority-catalog-test"/);
  assert.match(accumulatedRestoreBody, /git show[\s\S]*tests\/user-authority-catalog\.test\.mjs/);
  const restoreBody = step("Restore User follower authority source package");
  assert.match(restoreBody, /"\$holding\/user-authority-catalog-script"/);
  assert.match(restoreBody, /"\$holding\/user-authority-catalog-test"/);
});
