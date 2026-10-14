import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-callers-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

const migrations = new Map([
  ["20261013130000_move_seller_supported_snapshot_sql_callers", "7e3f5c19b71c110a4a8aa979500e23853696724eecb095c211e07d7f0eda3e78"],
  ["20261013140000_move_checkout_seller_private_sql_callers", "a904f6dd17f76dd6ff3e2f4f4278196d1379e8433413bc1d9a77af9509ec9ae7"],
  ["20261013150000_move_custom_order_seller_private_sql_callers", "0539711a7970f72be4c5fdd48cd16ad3bbab5d136e3f457141f00031e5b6da47"],
  ["20261013160000_move_case_guild_seller_private_sql_caller", "ed413c681bdf2bdec37ca238281a3cec5058ddff89eae09595b9b3c16822f77d"],
  ["20261013170000_move_order_label_seller_private_sql_caller", "5dd4ed4d4d4fb3fb767abb3fa96e616d9ea753db245a6d4c99e8ab3d7a8d2be8"],
  ["20261013180000_move_provider_identity_seller_private_sql_callers", "b00708a8cff7171ac148087a808a928472ea283beb6b67e961e39fb808fb0992"],
  ["20261013190000_move_reconciliation_seller_private_sql_callers", "3d76c45f60d4379253c2bdd57d0d3ce79d5e2c2ae9cad84b1f1027baf84d93e4"],
  ["20261013200000_move_final_seller_private_sql_callers", "9293316672717416574d53b485b8af9d16b0757801633b493696a24329362064"],
  ["20261013210000_move_account_deletion_seller_private_sql_callers", "4d4ec8b51d24cfbdc723cdb461183711a15397c0ed2e3b2abdf33cdcc9990893"],
  ["20261014010000_tolerate_missing_seller_reconciliation_target", "12e521eabf40128aae149eb9e00cd4cbd9041bbddb5b37a3c28821132933ad90"],
]);

test("caller release is exact-main, exact-CI, and Production-reviewed", () => {
  assert.match(workflow, /name: SellerProfile Private Callers Production/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-seller-profile-private-callers'/u,
  );
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

test("caller release pins the complete ordered migration batch", () => {
  for (const [migration, checksum] of migrations) {
    assert.match(workflow, new RegExp(migration, "u"));
    assert.match(
      workflow,
      new RegExp(`${checksum}  prisma/migrations/${migration}/migration\\.sql`, "u"),
    );
  }
  assert.match(
    workflow,
    /test "\$\(find prisma\/migrations[\s\S]*20261014010000_tolerate_missing_seller_reconciliation_target/u,
  );
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(
    workflow,
    /REVIEWED_PENDING_MIGRATIONS: \$\{\{ steps\.preflight\.outputs\.pending \}\}[\s\S]*assert-reviewed-pending-migrations\.mjs/u,
  );
});

test("caller release accepts only a restart-safe applied prefix", () => {
  assert.match(workflow, /SellerProfile caller migrations are not a prefix/u);
  assert.match(workflow, /successfulRow\(base\)/u);
  assert.match(workflow, /has duplicate successes/u);
  assert.match(workflow, /has an unresolved failed attempt/u);
  assert.match(
    workflow,
    /2404303e767ead69b7c9a7f8543519506552218dc25e254b3dc7ca4ea25e0305/u,
  );
  assert.match(workflow, /applied_count=\$\{appliedCount\}/u);
  assert.match(workflow, /pending=\$\{pending\.join\(','\)\}/u);
  assert.match(
    workflow,
    /if: steps\.preflight\.outputs\.applied_count != '10'/u,
  );
});

test("preflight and postflight preserve the private-boundary safety posture", () => {
  const inspect = workflow.indexOf("Inspect restart-safe caller prefix");
  const requirePending = workflow.indexOf("Require only the reviewed caller suffix pending");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfile caller suffix");
  const readback = workflow.indexOf("Read back exact caller ledger");
  const audit = workflow.indexOf("Audit global runtime grants after caller release");
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
  assert.match(workflow, /grainline_seller_profile_deauthorize_compat/u);
  assert.match(workflow, /grainline_seller_profile_reconciliation_required_compat/u);
  assert.match(workflow, /runtime_execute: false, public_execute: false/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
});

test("release has no application deploy or RLS activation and preserves sanitized evidence", () => {
  assert.doesNotMatch(
    workflow,
    /vercel deploy|git push|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu,
  );
  assert.match(workflow, /seller-profile-callers-preflight\.json/u);
  assert.match(workflow, /seller-profile-callers-postflight\.json/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /SELECT \* FROM public\."SellerProfilePrivate"/u);
  const verify = ci.slice(
    ci.indexOf("Verify SellerProfile private-boundary source package"),
    ci.indexOf("Verify seller listing Hide/Delete source package"),
  );
  assert.match(
    verify,
    /tests\/seller-profile-private-callers-production-workflow\.test\.mjs/u,
  );
});
