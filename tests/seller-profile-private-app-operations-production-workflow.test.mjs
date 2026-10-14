import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-app-operations-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

const migrations = new Map([
  ["20261014120000_prepare_seller_profile_private_stripe_app_authorities", "b3f62e41d09f0dda066980d34a40bccc88d8551a5a641867fdd8942f1703cab2"],
  ["20261014130000_prepare_seller_profile_private_shipping_quote_authority", "88528c378d6ed7ebf7046908541ebb1ab636bae5719b2c674fee0778090e3987"],
  ["20261014140000_prepare_seller_profile_private_checkout_app_authority", "dee3c6d5afe3c84a193139239c9aabdb9aaa21ac0cfa3ef3f8d682922da814d0"],
  ["20261014150000_prepare_seller_profile_private_owner_app_authorities", "4c9f38ba55c3abf3f538310576bb036b1b99dcc9723d13b0ec82398ac577fd07"],
  ["20261014160000_prepare_seller_profile_private_account_deletion_app_authorities", "982de793ea2e4fbdeda4b3d3c0aa18757b8fb69fef81fa7b881bcbb2efb569c9"],
  ["20261014170000_prepare_seller_profile_private_guild_listing_threshold_authority", "2cce1ee4ed9924f191d0450f32fffecc08c1307d36939f3e19038a3825858876"],
  ["20261014180000_prepare_seller_profile_private_guild_cron_batch_authorities", "ad7259e3934452a34bd69de409c805118797dc363fd93b019a3793d0ec428ad4"],
  ["20261014190000_prepare_seller_profile_private_guild_metrics_authority", "81ad8a2db1bdfbed9887bee645f3376396ab854a805e48c377f8b8b8b52ae87d"],
  ["20261014200000_prepare_seller_profile_private_guild_member_revocation_authority", "e8943d3d645e265fa2377461964c83550325280d8607289a37f6c22322bc0ecf"],
  ["20261014210000_prepare_seller_profile_private_guild_staff_read_authorities", "0cddda145727d794b9cc2711e7491c9c0da0509f39e3abaa96c30a0bd437ba05"],
  ["20261014220000_prepare_seller_profile_private_guild_staff_transition_authority", "4826a423180823afd410cbd625425837fe02855cb9965509ce4ad8cd53fa12e0"],
]);

test("application-operation release is exact-main, exact-CI, and Production-reviewed", () => {
  assert.match(workflow, /name: SellerProfile Private App Operations Production/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-seller-profile-private-app-operations'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.name !== 'CI'/u);
  assert.match(workflow, /run\.event !== 'push'/u);
  assert.match(workflow, /run\.head_branch !== 'main'/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
});

test("application-operation release pins the complete ordered batch", () => {
  for (const [migration, checksum] of migrations) {
    assert.match(workflow, new RegExp(migration, "u"));
    assert.match(
      workflow,
      new RegExp(`${checksum}  prisma/migrations/${migration}/migration\\.sql`, "u"),
    );
  }
  assert.match(
    workflow,
    /test "\$\(find prisma\/migrations[\s\S]*20261014220000_prepare_seller_profile_private_guild_staff_transition_authority/u,
  );
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(
    workflow,
    /REVIEWED_PENDING_MIGRATIONS: \$\{\{ steps\.preflight\.outputs\.pending \}\}[\s\S]*assert-reviewed-pending-migrations\.mjs/u,
  );
});

test("application-operation release accepts only a restart-safe applied prefix", () => {
  assert.match(workflow, /application-operation migrations are not a prefix/u);
  assert.match(workflow, /successfulRow\(base\)/u);
  assert.match(workflow, /has duplicate successes/u);
  assert.match(workflow, /has an unresolved failed attempt/u);
  assert.match(workflow, /12e521eabf40128aae149eb9e00cd4cbd9041bbddb5b37a3c28821132933ad90/u);
  assert.match(workflow, /applied_count=\$\{appliedCount\}/u);
  assert.match(workflow, /pending=\$\{pending\.join\(','\)\}/u);
  assert.match(workflow, /if: steps\.preflight\.outputs\.applied_count != '11'/u);
});

test("preflight and postflight preserve private-boundary posture", () => {
  const inspect = workflow.indexOf("Inspect restart-safe application-operation prefix");
  const requirePending = workflow.indexOf("Require only the reviewed application-operation suffix pending");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfile private application-operation suffix");
  const readback = workflow.indexOf("Read back exact application-operation ledger");
  const audit = workflow.indexOf("Audit global runtime grants after application-operation release");
  assert.ok(inspect >= 0 && requirePending > inspect && apply > requirePending);
  assert.ok(readback > apply && audit > readback);
  assert.match(workflow, /publicPosture\.relrowsecurity, false/u);
  assert.match(workflow, /publicPosture\.relforcerowsecurity, false/u);
  assert.match(workflow, /runtime_any: false, public_any: false/u);
  assert.equal((workflow.match(/convergence\.private_mismatch_count, 0/gu) ?? []).length, 2);
  assert.match(workflow, /private\."stripeAccountId" IS DISTINCT FROM source\."stripeAccountId"/u);
  assert.match(workflow, /private\."shipFromLine1" IS DISTINCT FROM source\."shipFromLine1"/u);
  assert.match(workflow, /private\."profileViews" IS DISTINCT FROM source\."profileViews"/u);
  assert.match(workflow, /convergence\.snapshot_mismatch_count, 0/u);
  assert.match(workflow, /assert\.deepEqual\(publicPosture, before\.publicPosture\)/u);
  assert.match(workflow, /assert\.deepEqual\(privatePosture, before\.privatePosture\)/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
});

test("release applies SQL only and preserves sanitized evidence", () => {
  assert.doesNotMatch(
    workflow,
    /vercel deploy|git push|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu,
  );
  assert.match(workflow, /seller-profile-app-operations-preflight\.json/u);
  assert.match(workflow, /seller-profile-app-operations-postflight\.json/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /SELECT \* FROM public\."SellerProfilePrivate"/u);
  const verify = ci.slice(
    ci.indexOf("Verify SellerProfile private-boundary source package"),
    ci.indexOf("Verify seller listing Hide/Delete source package"),
  );
  assert.match(verify, /tests\/seller-profile-private-app-operations-production-workflow\.test\.mjs/u);
  for (const migration of migrations.keys()) {
    assert.match(ci, new RegExp(migration, "u"));
  }
  assert.match(ci, /Apply SellerProfile private application-operation migrations in disposable PostgreSQL/u);
});
