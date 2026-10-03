import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-clerk-identity-preparation-production.yml",
  "utf8",
);

test("Clerk identity preparation is exact-main, predecessor-bound, and restart-aware", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-clerk-identity-preparation'/,
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
  assert.match(workflow, /force\.name !== 'UserEmailAddress FORCE Production'/);
  assert.match(workflow, /force\.event !== 'workflow_dispatch'/);
  assert.match(
    workflow,
    /force\.head_sha !== 'e689e1ff1d76a65146d132ad25dc545a72b87aac'/,
  );
  assert.match(workflow, /force\.run_attempt !== 1/);
  assert.match(workflow, /force\.conclusion !== 'success'/);
});

test("Clerk identity preparation applies only the checksum-pinned migration", () => {
  assert.match(
    workflow,
    /1aaebc3f8ef52af7692a4f3701ba39549d3a285e8245976876a16d3cf0bc6bf9[\s\S]*20261003100000_prepare_user_clerk_identity_authority/,
  );
  assert.match(
    workflow,
    /68bc032ecf38a63bd4ab9a219e315b69d8fa505bc3b99b6abf20e7d435812402[\s\S]*20261003100000_prepare_user_clerk_identity_authority/,
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
    /npx prisma migrate status[\s\S]*name: Apply only reviewed User Clerk identity preparation/,
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal(
    (workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("Clerk identity preparation preserves User and UserEmailAddress posture evidence", () => {
  assert.match(workflow, /EXPECTED_USER_EMAIL_ADDRESS_RLS_ENABLED: "true"/);
  assert.match(workflow, /EXPECTED_USER_EMAIL_ADDRESS_RLS_FORCED: "true"/);
  assert.match(
    workflow,
    /EXPECTED_USER_EMAIL_ADDRESS_RUNTIME_DIRECT_CRUD: "false"/,
  );
  assert.match(
    workflow,
    /EXPECTED_USER_CLERK_IDENTITY_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_CLERK_IDENTITY_STATE: applied/);
  assert.match(workflow, /user-email-address-authority-catalog\.mjs/);
  assert.match(workflow, /user-clerk-identity-production-inspect\.mjs/);
  assert.match(
    workflow,
    /assert\.deepEqual\(postIdentity\.catalog\.table, preIdentity\.catalog\.table\)/,
  );
  assert.match(
    workflow,
    /assert\.deepEqual\(postEmail\.result, preEmail\.result\)/,
  );
  assert.match(workflow, /postIdentity\.result\.functionCount, 3/);
  assert.match(workflow, /postIdentity\.result\.productionChanged, false/);
  assert.match(workflow, /postIdentity\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
