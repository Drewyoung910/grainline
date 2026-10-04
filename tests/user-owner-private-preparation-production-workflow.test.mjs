import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-owner-private-preparation-production.yml",
  "utf8",
);

test("owner-private preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-owner-private-preparation'/,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /main\.commit\.sha !== sha/);
  assert.match(workflow, /ci\.name !== 'CI'/);
  assert.match(workflow, /ci\.event !== 'push'/);
  assert.match(workflow, /ci\.head_sha !== sha/);
  assert.match(workflow, /ci\.conclusion !== 'success'/);
  assert.match(
    workflow,
    /preparation\.name !== 'User Clerk Provider Lifecycle Preparation Production'/,
  );
  assert.match(
    workflow,
    /preparation\.head_sha !== 'c96edf343f53e74244293ef465d07ceaab17fb30'/,
  );
  assert.match(workflow, /preparation\.run_attempt !== 1/);
  assert.match(workflow, /preparation\.conclusion !== 'success'/);
  assert.match(workflow, /preparationRunId !== 37173784936/);
});

test("owner-private preparation applies only the checksum-pinned migration", () => {
  assert.match(
    workflow,
    /07604e3a3d93c0a20bfbd13a3a6393c6bf7e5b4b158100ca91ef32794846291b[\s\S]*20261004010000_prepare_user_owner_private_authorities/,
  );
  assert.match(
    workflow,
    /6c5407b40e59ef1a6734b042e01476d8665253bcfd3fb4a257b79fe4f2963a34[\s\S]*20261004010000_prepare_user_owner_private_authorities/,
  );
  assert.match(workflow, /guard-production-migration-runner\.mjs/);
  assert.match(workflow, /candidateRows\.length === 0/);
  assert.match(
    workflow,
    /state=\$\{candidateRows\.length === 1 \? 'applied' : 'pending'\}/,
  );
  assert.match(
    workflow,
    /name: Require every predecessor applied and no unrelated migration pending/,
  );
  assert.match(workflow, /mv "prisma\/migrations\/\$migration" "\$holding"/);
  assert.match(
    workflow,
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User owner-private preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("owner-private preparation preserves predecessors and table posture evidence", () => {
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CURRENT_CLERK_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CLERK_PROVIDER_LIFECYCLE_STATE: applied/);
  assert.match(
    workflow,
    /EXPECTED_USER_OWNER_PRIVATE_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_OWNER_PRIVATE_STATE: applied/);
  assert.match(workflow, /user-clerk-identity-production-inspect\.mjs/);
  assert.match(workflow, /user-current-clerk-authorities-production-inspect\.mjs/);
  assert.match(workflow, /user-clerk-provider-lifecycle-production-inspect\.mjs/);
  assert.match(workflow, /user-owner-private-production-inspect\.mjs/);
  assert.match(workflow, /assert\.deepEqual\(postIdentity, preIdentity\)/);
  assert.match(workflow, /assert\.deepEqual\(postCurrent, preCurrent\)/);
  assert.match(
    workflow,
    /assert\.deepEqual\(postLifecycle, preLifecycle\)/,
  );
  assert.match(workflow, /postOwner\.result\.functionCount, 3/);
  assert.match(workflow, /postOwner\.result\.productionChanged, false/);
  assert.match(workflow, /postOwner\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
