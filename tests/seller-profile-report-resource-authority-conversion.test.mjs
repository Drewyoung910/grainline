import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");
const access = readFileSync("src/lib/sellerProfilePublicAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020235997_prepare_seller_profile_actor_report_resource_target/migration.sql",
  "utf8",
);

test("listing and review reports use one actor-bound resource authority", () => {
  assert.match(
    route,
    /sellerActorReportResourceTarget\(\s*me\.id,\s*body\.targetType,\s*body\.targetId,\s*reportedId,\s*\)/u,
  );
  assert.doesNotMatch(route, /prisma\.listing\.findUnique/u);
  assert.doesNotMatch(route, /prisma\.review\.findUnique/u);
  assert.doesNotMatch(route, /canViewListingDetail/u);
  assert.match(access, /withDbUserContext\(actorUserId, \(client\) =>\s*readSellerActorReportResourceTarget/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /p_target_type NOT IN \('LISTING', 'REVIEW'\)/u);
  assert.match(migration, /review\."reviewerId" = actor_id\s*OR seller\."userId" = actor_id/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_actor_report_resource_target\(text,text,text\)\s*FROM PUBLIC, grainline_app_runtime/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_seller_actor_report_resource_target\(text,text,text\)\s*TO grainline_app_runtime/u);
});
