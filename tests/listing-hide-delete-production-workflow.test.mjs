import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/listing-hide-delete-production.yml",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20261013040000_add_listing_archived_at/migration.sql",
  "utf8",
);

test("listing release is manual, exact-main, exact-CI, and Production serialized", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-listing-hide-delete'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
});

test("listing release admits only the reviewed migration after its exact predecessor", () => {
  assert.match(workflow, /b691aac5db56d1fb3b185c5c47b58e3a167cfb01ccb6ebf7cdd0a798cc1f59eb/u);
  assert.match(workflow, /20261012120000_force_account_deletion_side_effect_rls/u);
  assert.match(workflow, /7bcb3ecfeab41ec457a58845e380b8837b21e75ac077ef0c045674ff1a4ce7ec/u);
  assert.match(workflow, /REVIEWED_PENDING_MIGRATIONS="\$migration"/u);
  assert.match(workflow, /Apply only the reviewed listing compatibility migration[\s\S]*npx prisma migrate deploy/u);
});

test("postflight proves the additive catalog and unchanged Listing RLS posture", () => {
  assert.match(workflow, /grainline_listing_delete_reference_state\(text,text\)'::regprocedure/u);
  assert.match(workflow, /assert\.equal\(authority\.rows\[0\]\.owner, 'neondb_owner'\)/u);
  assert.match(workflow, /assert\.equal\(authority\.rows\[0\]\.prosrc, expectedSource\)/u);
  assert.match(workflow, /assert\.equal\(authority\.rows\[0\]\.runtime_execute, true\)/u);
  assert.match(workflow, /assert\.equal\(authority\.rows\[0\]\.public_execute, false\)/u);
  assert.match(workflow, /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows, before\)/u);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
});
