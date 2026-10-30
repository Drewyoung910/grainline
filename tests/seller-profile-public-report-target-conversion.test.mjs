import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261028060000_prepare_user_report_authorities/migration.sql",
  "utf8",
);

test("seller-profile reports use the consolidated actor-bound report authority", () => {
  assert.match(route, /createUserReport\(\{/u);
  assert.match(route, /targetType: body\.targetType \?\? null/u);
  assert.doesNotMatch(route, /sellerPublicReportTarget|sellerActorReportResourceTarget/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile|visibleSellerProfileWhere/u);
});

test("consolidated report submission preserves seller eligibility and exact grants", () => {
  assert.match(migration, /'LISTING', 'MESSAGE_THREAD', 'REVIEW', 'BLOG_COMMENT', 'SELLER_PROFILE'/u);
  assert.match(migration, /ELSE\s+target_valid := public\.grainline_seller_public_report_target\(/u);
  assert.match(migration, /public\.grainline_seller_public_report_target\(/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_user_report_submit\([\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_user_report_submit\([\s\S]*TO grainline_app_runtime/u,
  );
});
