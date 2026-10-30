import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");
const access = readFileSync("src/lib/userReportAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261028060000_prepare_user_report_authorities/migration.sql",
  "utf8",
);

test("listing and review reports use one actor-bound report authority", () => {
  assert.match(route, /createUserReport\(\{/u);
  assert.doesNotMatch(route, /prisma\.listing\.findUnique/u);
  assert.doesNotMatch(route, /prisma\.review\.findUnique/u);
  assert.doesNotMatch(route, /canViewListingDetail/u);
  assert.match(access, /withDbUserContext\(actorUserId, async \(client\) =>/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /p_target_type = 'LISTING'/u);
  assert.match(migration, /p_target_type = 'REVIEW'/u);
  assert.match(migration, /review\."reviewerId" = actor_id\s*OR seller\."userId" = actor_id/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_user_report_submit\(/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_user_report_submit\([\s\S]*TO grainline_app_runtime/u);
});
