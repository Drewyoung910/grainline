import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-app-authorities-correction-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

const correction = "20261015000000_correct_seller_profile_private_app_authorities";
const retirement = "20261015010000_retire_seller_profile_private_predecessor";
const correctionDigest = "3136a21f44e0be6e488adcad25c2d9c1c7a789e5f7adb387b31309c592c56309";

test("SellerProfile correction release is exact-main, exact-CI, and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
});

test("correction release admits only the immutable correction and holds retirement", () => {
  assert.match(workflow, new RegExp(`${correctionDigest}  prisma/migrations/${correction}/migration\\.sql`, "u"));
  assert.ok(workflow.includes('mv "prisma/migrations/$retirement" "$holding"'));
  assert.match(workflow, new RegExp(retirement, "u"));
  assert.match(workflow, /REVIEWED_PENDING_MIGRATIONS: \$\{\{ steps\.preflight\.outputs\.pending \}\}/u);
  assert.match(workflow, /node scripts\/assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
});

test("correction postflight proves the four fixes and preserves posture", () => {
  for (const name of [
    "grainline_seller_guild_staff_roster",
    "grainline_seller_guild_staff_transition",
    "grainline_seller_account_deletion_reconciliation_clear",
    "grainline_seller_staff_orderability_state",
  ]) assert.match(workflow, new RegExp(name, "u"));
  assert.match(workflow, /p_cohort IS NULL/u);
  assert.match(workflow, /p_operation IS NULL/u);
  assert.match(workflow, /left\\\(p_review_notes, 500\\\)/u);
  assert.match(workflow, /stripeAccountId.*::text/u);
  assert.match(workflow, /assert\.deepEqual\(posture, before\.posture\)/u);
  assert.match(workflow, /public_private_any/u);
  assert.match(workflow, /coalesce\(target\.relacl, pg_catalog\.acldefault/u);
  assert.doesNotMatch(workflow, /pg_catalog\.coalesce/u);
  assert.match(workflow, /predecessor retirement was already attempted before the correction release/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
});

test("CI proves and applies correction before retirement", () => {
  const source = ci.indexOf("Verify SellerProfile private-boundary source package");
  const correctionApply = ci.indexOf("Apply SellerProfile private app-authority correction in disposable PostgreSQL");
  const retirementApply = ci.indexOf("Apply SellerProfile private predecessor retirement in disposable PostgreSQL");
  const grants = ci.indexOf("Converge runtime grants after SellerProfile private boundary");
  assert.ok(source >= 0 && correctionApply > source && retirementApply > correctionApply && grants > retirementApply);
  assert.match(ci, /seller-profile-private-app-authorities-correction-production-workflow\.test\.mjs/u);
  assert.match(ci, new RegExp(correction, "u"));
  assert.match(ci, new RegExp(retirement, "u"));
  assert.match(
    ci,
    /Apply SellerProfile private app-authority correction in disposable PostgreSQL[\s\S]*'sph-' \|\| pg_catalog\.md5\(:'migration'\)/u,
  );
});
