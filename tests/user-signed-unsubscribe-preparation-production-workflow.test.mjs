import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-signed-unsubscribe-preparation-production.yml",
  "utf8",
);

test("signed-unsubscribe preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-signed-unsubscribe-preparation'/,
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
    /preparation\.name !== 'User Owner-Private Preparation Production'/,
  );
  assert.match(
    workflow,
    /preparation\.head_sha !== '3335f3809b91229cfebb7c07f127b90cb561b6e2'/,
  );
  assert.match(workflow, /preparation\.run_attempt !== 1/);
  assert.match(workflow, /preparation\.conclusion !== 'success'/);
  assert.match(workflow, /preparationRunId !== 37180281982/);
});

test("signed-unsubscribe preparation applies only the checksum-pinned migration", () => {
  assert.match(
    workflow,
    /9dca041fa5d1a339e36459ef9fe2b3e0b0678bd0ffb9dc8a410510a3ad0d6dd4[\s\S]*20261004020000_prepare_user_signed_unsubscribe_authorities/,
  );
  assert.match(
    workflow,
    /07604e3a3d93c0a20bfbd13a3a6393c6bf7e5b4b158100ca91ef32794846291b[\s\S]*20261004020000_prepare_user_signed_unsubscribe_authorities/,
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
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User signed-unsubscribe preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("signed-unsubscribe preparation preserves all predecessor catalogs and User posture", () => {
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CURRENT_CLERK_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CLERK_PROVIDER_LIFECYCLE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_OWNER_PRIVATE_STATE: applied/);
  assert.match(
    workflow,
    /EXPECTED_USER_SIGNED_UNSUBSCRIBE_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_SIGNED_UNSUBSCRIBE_STATE: applied/);
  assert.match(workflow, /user-clerk-identity-production-inspect\.mjs/);
  assert.match(workflow, /user-current-clerk-authorities-production-inspect\.mjs/);
  assert.match(workflow, /user-clerk-provider-lifecycle-production-inspect\.mjs/);
  assert.match(workflow, /user-owner-private-production-inspect\.mjs/);
  assert.match(workflow, /user-signed-unsubscribe-production-inspect\.mjs/);
  assert.match(workflow, /assert\.deepEqual\(postIdentity, preIdentity\)/);
  assert.match(workflow, /assert\.deepEqual\(postCurrent, preCurrent\)/);
  assert.match(workflow, /assert\.deepEqual\(postLifecycle, preLifecycle\)/);
  assert.match(workflow, /assert\.deepEqual\(postOwner, preOwner\)/);
  assert.match(workflow, /postSigned\.result\.functionCount, 2/);
  assert.match(workflow, /postSigned\.result\.productionChanged, false/);
  assert.match(workflow, /postSigned\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
