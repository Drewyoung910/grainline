import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-boundary-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = "20261013120000_prepare_seller_profile_private_boundary";
const checksum = "4c492de6cf7a8f7b1df6cfda1339906e0ae196e30a097aef1609ae96bb0ec219";

test("SellerProfile private-boundary release is exact-main, exact-CI, and Production-reviewed", () => {
  assert.match(workflow, /name: SellerProfile Private Boundary Production/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-seller-profile-private-boundary'/u,
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
  assert.match(workflow, new RegExp(`${checksum}  prisma/migrations/${migration}/migration\\.sql`, "u"));
});

test("release admits and applies exactly the one reviewed migration", () => {
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 3);
  assert.equal(
    (workflow.match(/assert-reviewed-pending-migrations\.mjs/gu) ?? []).length,
    3,
  );
  assert.match(
    workflow,
    new RegExp(
      `mv "prisma/migrations/\\$migration" "\\$holding"[\\s\\S]*npx prisma migrate status[\\s\\S]*mv "\\$holding" "prisma/migrations/\\$migration"[\\s\\S]*REVIEWED_PENDING_MIGRATIONS="\\$migration"`,
      "u",
    ),
  );
  assert.match(
    workflow,
    /steps\.preflight\.outputs\.state == 'pending'/u,
  );
  assert.doesNotMatch(workflow, /vercel deploy|git push|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
});

test("preflight rejects partial state and requires the accepted listing predecessor", () => {
  assert.match(workflow, /20261013040000_add_listing_archived_at/u);
  assert.match(
    workflow,
    /b691aac5db56d1fb3b185c5c47b58e3a167cfb01ccb6ebf7cdd0a798cc1f59eb/u,
  );
  for (const object of [
    "SellerProfilePrivate",
    "stripeAccountSupported",
    "grainline_seller_profile_private_mirror",
    "grainline_seller_profile_supported_snapshot",
    "SellerProfile_private_mirror",
    "SellerProfile_supported_snapshot",
  ]) assert.match(workflow, new RegExp(object, "u"));
  assert.match(workflow, /assert\.deepEqual\(collision, \{/u);
  assert.match(workflow, /migrationState: candidate \? 'applied' : 'pending'/u);
});

test("postflight proves exact catalog, row convergence, and zero direct authority", () => {
  const readback = workflow.indexOf("Read back exact catalog and data convergence");
  const converged = workflow.indexOf("Require no pending migrations after apply");
  const audit = workflow.indexOf("Audit global runtime grants");
  const apply = workflow.indexOf("Apply only reviewed SellerProfile private-boundary migration");
  assert.ok(apply >= 0 && readback > apply && converged > readback && audit > converged);
  assert.match(workflow, /assert\.deepEqual\(publicPosture, before\.posture\)/u);
  assert.match(workflow, /relrowsecurity: false, relforcerowsecurity: false/u);
  assert.match(workflow, /runtime_any: false, public_any: false/u);
  assert.match(workflow, /runtime_column_any: false, public_column_any: false/u);
  assert.doesNotMatch(workflow, /has_(?:table|any_column|function)_privilege\(0,/u);
  assert.equal((workflow.match(/acl\.grantee = 0/gu) ?? []).length, 3);
  assert.match(workflow, /convergence\.mismatch_count, 0/u);
  assert.match(workflow, /convergence\.snapshot_mismatch_count, 0/u);
  assert.match(workflow, /prosrc: reviewedBody\('grainline_seller_profile_private_mirror'\)/u);
  assert.match(workflow, /prosrc: reviewedBody\('grainline_seller_profile_supported_snapshot'\)/u);
  assert.match(workflow, /runtime_execute: false, public_execute: false/u);
  assert.match(workflow, /SellerProfilePrivate_sellerProfileId_fkey/u);
  assert.match(workflow, /SellerProfile_stripeAccountSupported_check/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
});

test("release evidence is sanitized and CI exercises the release wiring before isolation", () => {
  assert.match(workflow, /seller-profile-private-preflight\.json/u);
  assert.match(workflow, /seller-profile-private-postflight\.json/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /SELECT \* FROM public\."SellerProfilePrivate"/u);
  assert.doesNotMatch(workflow, /shipFromLine1[^\n]*JSON|stripeAccountId[^\n]*JSON/iu);
  const verify = ci.slice(
    ci.indexOf("Verify SellerProfile private-boundary source package"),
    ci.indexOf("Verify seller listing Hide/Delete source package"),
  );
  assert.match(
    verify,
    /tests\/seller-profile-private-boundary-production-workflow\.test\.mjs/u,
  );
  assert.ok(
    ci.indexOf("Verify SellerProfile private-boundary source package")
      < ci.indexOf("Isolate SellerProfile private-boundary migration"),
  );
});
