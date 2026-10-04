import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-email-delivery-preparation-production.yml",
  "utf8",
);

test("email-delivery preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-email-delivery-preparation'/,
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
    /preparation\.name !== 'User Signed Unsubscribe Preparation Production'/,
  );
  assert.match(
    workflow,
    /preparation\.head_sha !== '235450c09102be70b3487944b00238d85d5b77ec'/,
  );
  assert.match(workflow, /preparation\.run_attempt !== 1/);
  assert.match(workflow, /preparation\.conclusion !== 'success'/);
  assert.match(workflow, /preparationRunId !== 37184090133/);
});

test("email-delivery preparation applies only the checksum-pinned migration", () => {
  assert.match(
    workflow,
    /315181ae09239090afb7bdb5bd5ba0c81d25338994f192f99e3975662cad345b[\s\S]*20261004030000_prepare_user_email_delivery_authorities/,
  );
  assert.match(
    workflow,
    /9dca041fa5d1a339e36459ef9fe2b3e0b0678bd0ffb9dc8a410510a3ad0d6dd4[\s\S]*20261004030000_prepare_user_email_delivery_authorities/,
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
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User email-delivery preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("email-delivery preparation preserves all predecessor catalogs and User posture", () => {
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CURRENT_CLERK_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CLERK_PROVIDER_LIFECYCLE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_OWNER_PRIVATE_STATE: applied/);
  assert.match(
    workflow,
    /EXPECTED_USER_EMAIL_DELIVERY_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_EMAIL_DELIVERY_STATE: applied/);
  assert.match(workflow, /user-clerk-identity-production-inspect\.mjs/);
  assert.match(workflow, /user-current-clerk-authorities-production-inspect\.mjs/);
  assert.match(workflow, /user-clerk-provider-lifecycle-production-inspect\.mjs/);
  assert.match(workflow, /user-owner-private-production-inspect\.mjs/);
  assert.match(workflow, /user-email-delivery-production-inspect\.mjs/);
  assert.match(workflow, /assert\.deepEqual\(postIdentity, preIdentity\)/);
  assert.match(workflow, /assert\.deepEqual\(postCurrent, preCurrent\)/);
  assert.match(workflow, /assert\.deepEqual\(postLifecycle, preLifecycle\)/);
  assert.match(workflow, /assert\.deepEqual\(postOwner, preOwner\)/);
  assert.match(workflow, /postEmail\.result\.functionCount, 4/);
  assert.match(workflow, /postEmail\.result\.productionChanged, false/);
  assert.match(workflow, /postEmail\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
