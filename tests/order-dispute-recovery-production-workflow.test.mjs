import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/order-dispute-recovery-production.yml",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260930040000_prepare_order_dispute_recovery/migration.sql",
  "utf8",
);

test("Order dispute-recovery workflow parses as YAML", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.ok(parsed.jobs.apply.steps.length >= 9);
});

test("inline production readback programs are syntactically valid modules", () => {
  const scripts = [
    ...workflow.matchAll(
      /node --input-type=module - <<'NODE'\n([\s\S]*?)\n\s+NODE/gu,
    ),
  ].map((match) => match[1].replace(/^ {10}/gmu, ""));
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    const checked = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { input: script, encoding: "utf8" },
    );
    assert.equal(checked.status, 0, checked.stderr);
  }
});

test("Order dispute-recovery workflow is manual, exact-main and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-order-dispute-recovery'/u,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
});

test("workflow admits only the exact latest migration after ops health", () => {
  assert.match(
    workflow,
    /555e26acc3c9d6361d629d86225b63177667363de4ac299c37696072504a9799\s+prisma\/migrations\/20260930040000_prepare_order_dispute_recovery\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /tail -n 1[\s\S]*20260930040000_prepare_order_dispute_recovery/u,
  );
  assert.match(workflow, /20260930033000_order_ops_health_summary/u);
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Order dispute-recovery migration/u,
  );
});

test("workflow proves the private ledger and exact fixed-function authority", () => {
  assert.match(workflow, /OrderDisputeRecoveryStatus/u);
  assert.match(workflow, /expectedConstraints/u);
  assert.match(workflow, /expectedIndexes/u);
  assert.match(workflow, /rls_enabled: true/u);
  assert.match(workflow, /force_enabled: true/u);
  assert.match(workflow, /policy_count: 0/u);
  assert.match(workflow, /runtime_table_privilege: false/u);
  assert.match(workflow, /public_table_privilege: false/u);
  assert.match(
    workflow,
    /assert\.equal\(row\.prosrc, sourceFor\(expected\[0\]\)\)/u,
  );
  assert.match(workflow, /assert\.equal\(row\.runtime_execute, true\)/u);
  assert.match(workflow, /assert\.equal\(row\.public_execute, false\)/u);
  assert.match(
    workflow,
    /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows, before\)/u,
  );
});

test("workflow cannot deploy the app or invoke Stripe", () => {
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(
    workflow,
    /stripe\s+(?:charges|transfers|refunds|events)/iu,
  );
  assert.equal(
    (workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.match(
    migration,
    /ALTER TABLE public\."OrderDisputeRecovery" FORCE ROW LEVEL SECURITY/u,
  );
  assert.doesNotMatch(migration, /CREATE POLICY/u);
});
