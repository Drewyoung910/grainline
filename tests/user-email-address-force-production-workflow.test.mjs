import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflowPath =
  ".github/workflows/user-email-address-force-production.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

test("UserEmailAddress FORCE is manually exact-bound and restart-safe", () => {
  assert.match(workflow, /^name: UserEmailAddress FORCE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'force-reviewed-user-email-address-rls'/u,
  );
  assert.match(workflow, /ci\.name !== 'CI'/u);
  assert.match(workflow, /ci\.event !== 'push'/u);
  assert.match(workflow, /ci\.head_branch !== 'main'/u);
  assert.match(workflow, /ci\.head_sha !== sha/u);
  assert.match(workflow, /ci\.conclusion !== 'success'/u);
  assert.match(
    workflow,
    /68bc032ecf38a63bd4ab9a219e315b69d8fa505bc3b99b6abf20e7d435812402/u,
  );
  assert.match(
    workflow,
    /node scripts\/guard-production-migration-runner\.mjs/u,
  );
  assert.match(workflow, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(
    workflow,
    /a28a86aeec3084e4a41341d415fd1fd98446d32939f0fe55d0e53d5e27d8dece/u,
  );
  assert.match(workflow, /20261003020000_enable_user_email_address_rls/u);
  assert.match(
    workflow,
    /d61df27c1c565d6fffde2fea130eb27b2ef95e842dbffef5e6b2862cd57bcbee/u,
  );
  assert.match(workflow, /assert\.equal\(activationRows\.length, 1\)/u);
  assert.match(workflow, /finished_at IS NULL AND rolled_back_at IS NULL/u);
  assert.match(workflow, /npx prisma migrate status/u);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/u);
  assert.match(workflow, /run: npx prisma migrate deploy/u);
  assert.match(workflow, /EXPECTED_USER_EMAIL_ADDRESS_RLS_ENABLED: "true"/u);
  assert.match(workflow, /EXPECTED_USER_EMAIL_ADDRESS_RLS_FORCED: "true"/u);
  assert.match(
    workflow,
    /EXPECTED_USER_EMAIL_ADDRESS_RUNTIME_DIRECT_CRUD: "false"/u,
  );
  assert.match(
    workflow,
    /node scripts\/user-email-address-authority-catalog\.mjs/u,
  );
  assert.match(workflow, /npm run audit:db-grants/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(
    workflow,
    /vercel|deploy application|FORCE ROW LEVEL SECURITY/iu,
  );
});

test("workflow executes only the reviewed FORCE migration after a clean prefix", () => {
  const status = workflow.indexOf("npx prisma migrate status");
  const deploy = workflow.indexOf("run: npx prisma migrate deploy");
  const catalog = workflow.indexOf(
    "node scripts/user-email-address-authority-catalog.mjs",
  );
  assert.ok(status > 0 && deploy > status && catalog > deploy);
  assert.equal(
    (workflow.match(/20261003030000_force_user_email_address_rls/gu) ?? [])
      .length,
    5,
  );
});
