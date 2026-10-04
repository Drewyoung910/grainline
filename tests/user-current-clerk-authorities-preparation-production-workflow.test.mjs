import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-current-clerk-authorities-preparation-production.yml",
  "utf8",
);

test("current-Clerk preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-current-clerk-authorities-preparation'/,
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
    /preparation\.name !== 'User Clerk Identity Preparation Production'/,
  );
  assert.match(
    workflow,
    /preparation\.head_sha !== 'f156dd9b28e80e98ec1f5ec422f95eda4a0e0d0f'/,
  );
  assert.match(workflow, /preparation\.run_attempt !== 1/);
  assert.match(workflow, /preparation\.conclusion !== 'success'/);
});

test("current-Clerk preparation applies only the checksum-pinned migration", () => {
  assert.match(
    workflow,
    /c3cd7b9b5da23074fe676593cf7cbfbd2765c7c0decac2f33e941c7f90a59386[\s\S]*20261003230000_prepare_user_current_clerk_authorities/,
  );
  assert.match(
    workflow,
    /1aaebc3f8ef52af7692a4f3701ba39549d3a285e8245976876a16d3cf0bc6bf9[\s\S]*20261003230000_prepare_user_current_clerk_authorities/,
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
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User current-Clerk preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("current-Clerk preparation preserves predecessor and table posture evidence", () => {
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(
    workflow,
    /EXPECTED_USER_CURRENT_CLERK_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_CURRENT_CLERK_STATE: applied/);
  assert.match(workflow, /user-clerk-identity-production-inspect\.mjs/);
  assert.match(workflow, /user-current-clerk-authorities-production-inspect\.mjs/);
  assert.match(workflow, /assert\.deepEqual\(postIdentity, preIdentity\)/);
  assert.match(
    workflow,
    /assert\.deepEqual\(postCurrent\.catalog\.tables, preCurrent\.catalog\.tables\)/,
  );
  assert.match(workflow, /postCurrent\.result\.functionCount, 2/);
  assert.match(workflow, /postCurrent\.result\.productionChanged, false/);
  assert.match(workflow, /postCurrent\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
