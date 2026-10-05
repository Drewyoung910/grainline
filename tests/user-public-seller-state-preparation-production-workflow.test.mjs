import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-public-seller-state-preparation-production.yml",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20261004050000_prepare_user_public_seller_state/migration.sql",
);

test("seller-state preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-public-seller-state-preparation'/,
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
    /preparation\.name !== 'User Public Member Aggregate Preparation Production'/,
  );
  assert.match(
    workflow,
    /preparation\.head_sha !== 'b7782b6c68c2fccb5c4bddee9e4211fd58afd0ba'/,
  );
  assert.match(workflow, /preparation\.run_attempt !== 1/);
  assert.match(workflow, /preparation\.conclusion !== 'success'/);
  assert.match(workflow, /preparationRunId !== 37266377281/);
});

test("seller-state preparation applies only the checksum-pinned migration", () => {
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "e55bd7d1c907322c2c4843401209f1ceb910416ff667e0565f78ef378b108696",
  );
  const installIndex = workflow.indexOf("- run: npm ci --ignore-scripts");
  const generateIndex = workflow.indexOf("- run: npx prisma generate");
  const verifyIndex = workflow.indexOf(
    "- name: Verify exact User public seller-state source package",
  );
  assert.ok(installIndex >= 0);
  assert.ok(generateIndex > installIndex);
  assert.ok(verifyIndex > generateIndex);
  assert.match(
    workflow,
    /e55bd7d1c907322c2c4843401209f1ceb910416ff667e0565f78ef378b108696[\s\S]*20261004050000_prepare_user_public_seller_state/,
  );
  assert.match(
    workflow,
    /79356a45557837d5788ede525813388fca68ff1ebaf78113d81de6c1fc5167cc[\s\S]*20261004050000_prepare_user_public_seller_state/,
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
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User public seller-state preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("seller-state preparation preserves all predecessor catalogs and User posture", () => {
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CURRENT_CLERK_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_CLERK_PROVIDER_LIFECYCLE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_OWNER_PRIVATE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_SIGNED_UNSUBSCRIBE_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_EMAIL_DELIVERY_STATE: applied/);
  assert.match(workflow, /EXPECTED_USER_PUBLIC_MEMBER_AGGREGATE_STATE: applied/);
  assert.match(
    workflow,
    /EXPECTED_USER_PUBLIC_SELLER_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_PUBLIC_SELLER_STATE: applied/);
  assert.match(workflow, /user-email-delivery-production-inspect\.mjs/);
  assert.match(workflow, /user-public-member-aggregate-production-inspect\.mjs/);
  assert.match(workflow, /user-public-seller-state-production-inspect\.mjs/);
  assert.match(workflow, /assert\.deepEqual\(postEmail, preEmail\)/);
  assert.match(workflow, /assert\.deepEqual\(postMember, preMember\)/);
  assert.match(workflow, /postPublic\.result\.columnCount, 2/);
  assert.match(workflow, /postPublic\.result\.functionCount, 2/);
  assert.match(workflow, /postPublic\.result\.triggerCount, 2/);
  assert.match(workflow, /postPublic\.result\.productionChanged, false/);
  assert.match(workflow, /postPublic\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
