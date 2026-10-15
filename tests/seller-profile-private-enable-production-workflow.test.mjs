import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-enable-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const inspector = readFileSync(
  "scripts/seller-profile-private-enable-production-inspect.mjs",
  "utf8",
);
const migration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261015100000_enable_seller_profile_private_rls",
  ),
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/seller-profile-private-enable-rollback.sql",
  "utf8",
);
const digest = "9774282f05c2a3369fe8962bc88fca88928629746cfe67067eae853a4182f088";

test("SellerProfilePrivate ENABLE workflow is exact-main, invariant-bound, and Production-serialized", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, /name: SellerProfilePrivate ENABLE Production/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /ci\.head_sha !== sha/u);
  assert.match(workflow, /SellerProfile Private Invariants Production/u);
  assert.match(workflow, /seller-profile-private-invariants-production\.yml/u);
  assert.match(workflow, /Accepted invariant run is not an ancestor/u);
  assert.match(workflow, /Restore SellerProfile private invariants/u);
});

test("workflow admits exactly one restart-safe migration and keeps FORCE separate", () => {
  assert.match(workflow, new RegExp(`${digest}  prisma/migrations/\\$migration/migration\\.sql`, "u"));
  assert.match(workflow, /ready-or-enabled/u);
  assert.match(workflow, /Require only the reviewed SellerProfilePrivate ENABLE pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'ready'/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|FORCE ROW LEVEL SECURITY/iu);
});

test("workflow proves source before owner access and inspect-apply-postflight-audit in order", () => {
  const source = workflow.indexOf("Verify exact SellerProfilePrivate ENABLE source");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const preflight = workflow.indexOf("Inspect restart-safe SellerProfilePrivate state before ENABLE");
  const apply = workflow.indexOf("Apply only the reviewed SellerProfilePrivate ENABLE migration");
  const postflight = workflow.indexOf("Read back enabled SellerProfilePrivate catalog");
  const audit = workflow.indexOf("Audit global runtime grants after SellerProfilePrivate ENABLE");
  assert.ok(source >= 0 && source < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < postflight && postflight < audit);
});

test("main CI restores invariants before ENABLE and replays current-schema proofs afterward", () => {
  const restore = ci.indexOf(
    "Apply SellerProfile private invariant restoration in disposable PostgreSQL",
  );
  const enable = ci.indexOf(
    "Apply SellerProfilePrivate policyless ENABLE in disposable PostgreSQL",
  );
  const replay = ci.indexOf(
    "Re-prove SellerProfile-touching fixtures on the restored current schema",
  );
  const invariantMigration = ci.indexOf(
    "migration=20261015080000_restore_seller_profile_private_invariants",
    restore,
  );
  const enableMigration = ci.indexOf(
    "migration=20261015100000_enable_seller_profile_private_rls",
    enable,
  );
  assert.ok(restore >= 0 && restore < invariantMigration);
  assert.ok(invariantMigration < enable && enable < enableMigration);
  assert.ok(enableMigration < replay);
});

test("inspector is read-only, count-only, and distinguishes ready from enabled", () => {
  assert.match(inspector, /20261015080000_restore_seller_profile_private_invariants/u);
  assert.match(inspector, /20261015100000_enable_seller_profile_private_rls/u);
  assert.match(inspector, new RegExp(digest, "u"));
  assert.match(inspector, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(inspector, /state = enableApplied \? "enabled" : "ready"/u);
  assert.match(inspector, /public_rls: false/u);
  assert.match(inspector, /private_rls: enableApplied/u);
  assert.match(inspector, /policy_count: 0/u);
  assert.match(inspector, /containsRowData: false/u);
  assert.doesNotMatch(inspector, /SELECT\s+\*/iu);
});

test("migration is policyless ENABLE only and rollback restores the predecessor posture", () => {
  assert.match(migration, /ALTER TABLE public\."SellerProfilePrivate" ENABLE ROW LEVEL SECURITY/u);
  assert.match(migration, /ALTER TABLE public\."SellerProfilePrivate" NO FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(
    migration,
    /CREATE POLICY|ALTER TABLE public\."SellerProfilePrivate" FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(migration, /SellerProfilePrivate ENABLE crossed the public SellerProfile boundary/u);
  assert.match(rollback, /ALTER TABLE public\."SellerProfilePrivate" DISABLE ROW LEVEL SECURITY/u);
  assert.match(rollback, /REVOKE ALL ON TABLE public\."SellerProfilePrivate"/u);
});
