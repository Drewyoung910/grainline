import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/case-refund-provider-recovery-production.yml",
  "utf8",
);
const migrationPath = [
  process.env.CASE_REFUND_PROVIDER_RECOVERY_MIGRATION_PATH,
  "prisma/migrations/20261001070000_prepare_case_refund_provider_recovery/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/case-refund-provider-recovery/migration/migration.sql`
    : null,
].find((candidate) => candidate && existsSync(candidate));
assert.ok(
  migrationPath,
  "Case refund provider-recovery migration source must be available",
);
const migration = readFileSync(migrationPath, "utf8");

test("Case refund provider-recovery workflow parses as YAML", () => {
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

test("workflow is manual, exact-main, CI and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-case-refund-provider-recovery'/u,
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

test("workflow admits only the exact latest migration after quote FORCE", () => {
  assert.match(
    workflow,
    /68e559e01dbeae663931110dcadfd4d42ca050c788eebd647727f434a9a72dba\s+prisma\/migrations\/20261001070000_prepare_case_refund_provider_recovery\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /tail -n 1[\s\S]*20261001070000_prepare_case_refund_provider_recovery/u,
  );
  assert.match(workflow, /20261001060000_force_order_shipping_rate_quote_rls/u);
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Case refund provider-recovery migration/u,
  );
});

test("workflow refuses unledgered collisions and proves exact result", () => {
  assert.match(workflow, /providerRecovery%/u);
  assert.match(workflow, /index_identity: null/u);
  assert.match(workflow, /recovery_finalize: null/u);
  assert.match(workflow, /expectedColumns/u);
  assert.match(workflow, /datetime_precision/u);
  assert.match(workflow, /CaseResolutionClaim_providerRecovery_shape_check/u);
  assert.match(workflow, /pg_get_constraintdef/u);
  assert.match(workflow, /sourceSpecs/u);
  assert.match(
    workflow,
    /assert\.equal\(row\.prosrc, sourceFor\(expected\[0\]\)\)/u,
  );
  assert.match(
    workflow,
    /assert\.equal\(row\.runtime_execute, expected\[4\]\)/u,
  );
  assert.match(workflow, /assert\.equal\(row\.public_execute, false\)/u);
  assert.match(
    workflow,
    /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows, before\)/u,
  );
});

test("workflow cannot deploy the app or invoke payment providers", () => {
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(
    workflow,
    /stripe\s+(?:charges|transfers|refunds|events)/iu,
  );
  assert.equal(
    (workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/u);
  assert.doesNotMatch(migration, /CREATE POLICY/u);
});
