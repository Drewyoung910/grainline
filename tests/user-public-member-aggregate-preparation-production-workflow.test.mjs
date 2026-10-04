import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-public-member-aggregate-preparation-production.yml",
  "utf8",
);

test("public-member preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-public-member-aggregate-preparation'/,
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
    /preparation\.name !== 'User Email Delivery Preparation Production'/,
  );
  assert.match(
    workflow,
    /preparation\.head_sha !== 'd8a6d1c4b96f12015b6f329140b7e4b7a0054914'/,
  );
  assert.match(workflow, /preparation\.run_attempt !== 1/);
  assert.match(workflow, /preparation\.conclusion !== 'success'/);
  assert.match(workflow, /preparationRunId !== 37215932608/);
});

test("public-member preparation applies only the checksum-pinned migration", () => {
  assert.match(
    workflow,
    /79356a45557837d5788ede525813388fca68ff1ebaf78113d81de6c1fc5167cc[\s\S]*20261004040000_prepare_user_public_member_aggregate/,
  );
  assert.match(
    workflow,
    /315181ae09239090afb7bdb5bd5ba0c81d25338994f192f99e3975662cad345b[\s\S]*20261004040000_prepare_user_public_member_aggregate/,
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
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User public-member aggregate preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("public-member preparation preserves all predecessor catalogs and User posture", () => {
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CURRENT_CLERK_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CLERK_PROVIDER_LIFECYCLE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_OWNER_PRIVATE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_SIGNED_UNSUBSCRIBE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_EMAIL_DELIVERY_STATE: applied/);
  assert.match(
    workflow,
    /EXPECTED_USER_PUBLIC_MEMBER_AGGREGATE_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_PUBLIC_MEMBER_AGGREGATE_STATE: applied/);
  assert.match(workflow, /user-email-delivery-production-inspect\.mjs/);
  assert.match(workflow, /user-public-member-aggregate-production-inspect\.mjs/);
  assert.match(workflow, /assert\.deepEqual\(postEmail, preEmail\)/);
  assert.match(workflow, /postPublic\.result\.functionCount, 1/);
  assert.match(workflow, /postPublic\.result\.productionChanged, false/);
  assert.match(workflow, /postPublic\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
