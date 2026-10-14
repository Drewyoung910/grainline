import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/account-deletion-post-retirement-repair-production.yml",
  "utf8",
);
const repair = "20261015013000_repair_account_deletion_after_seller_profile_retirement";
const checksum = "c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368";

test("repair workflow parses as YAML", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.ok(parsed.jobs.apply.steps.length >= 10);
});

test("repair workflow is exact-main, exact-CI, first-attempt, and Production-bound", () => {
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
});

test("repair workflow admits only the exact immutable migration and is restart-safe", () => {
  assert.match(workflow, new RegExp(repair, "u"));
  assert.match(
    workflow,
    new RegExp(`${checksum}  prisma/migrations/\\$migration/migration\\.sql`, "u"),
  );
  assert.match(workflow, /Require only the reviewed repair pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'pending'/u);
});

test("repair workflow uses read-only sanitized inspection and no deployment or RLS activation", () => {
  assert.match(workflow, /account-deletion-post-retirement-production-inspect\.mjs/gu);
  assert.match(workflow, /ACCOUNT_DELETION_REPAIR_EXPECTED_STATE: compatible/u);
  assert.match(workflow, /ACCOUNT_DELETION_REPAIR_EXPECTED_STATE: repaired/u);
  assert.match(workflow, /seller-profile-retired-function-reference-postgres-proof\.mjs/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.doesNotMatch(
    workflow,
    /vercel\s+(?:deploy|alias|promote)|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu,
  );
});
