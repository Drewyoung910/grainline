import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/order-partial-refund-fulfillment-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261002010000_allow_partial_refund_fulfillment/migration.sql",
  "utf8",
);

test("partial-refund fulfillment workflow parses as YAML", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.ok(parsed.jobs.apply.steps.length >= 10);
});

test("inline Production readback programs are syntactically valid modules", () => {
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
    /inputs\.confirmation == 'apply-reviewed-order-partial-refund-fulfillment'/u,
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

test("workflow admits only the exact latest migration after its predecessor", () => {
  assert.match(
    workflow,
    /aed37ac898eaa6ede56e13834019aefdd8825c4b521422ad30c17733d008172c\s+prisma\/migrations\/20261002010000_allow_partial_refund_fulfillment\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /tail -n 1[\s\S]*20261002010000_allow_partial_refund_fulfillment/u,
  );
  assert.match(workflow, /20261001070000_prepare_case_refund_provider_recovery/u);
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed partial-refund fulfillment migration/u,
  );
});

test("CI isolates the successor until every accepted predecessor is restored", () => {
  const isolate = ci.indexOf(
    "Isolate partial-refund fulfillment until every predecessor passes",
  );
  const caseRecovery = ci.indexOf("Restore Case refund provider recovery");
  const restore = ci.indexOf("Restore partial-refund fulfillment successor");
  const apply = ci.indexOf(
    "Apply partial-refund fulfillment successor in disposable PostgreSQL",
  );
  assert.ok(isolate >= 0);
  assert.ok(caseRecovery > isolate);
  assert.ok(restore > caseRecovery);
  assert.ok(apply > restore);
  const isolateBlock = ci.slice(
    isolate,
    ci.indexOf("Verify Case refund provider-recovery source package", isolate),
  );
  assert.match(
    isolateBlock,
    /ORDER_PARTIAL_REFUND_FULFILLMENT_MIGRATION_PATH=.*migration\.sql/u,
  );
  assert.doesNotMatch(
    isolateBlock,
    /mv[\s\\]+tests\/order-(?:fulfillment|label)-authority-postgres\.test\.mjs/u,
  );
  assert.match(
    ci,
    /Verify exact Order child catalog after partial-refund successor/u,
  );
  assert.equal(
    (ci.match(/order-partial-refund-fulfillment-production-workflow\.test\.mjs/gu) ?? [])
      .length,
    6,
  );
});

test("workflow proves exact functions, ACL preservation and unchanged RLS posture", () => {
  assert.match(workflow, /unledgered partial-refund helper exists/u);
  assert.match(workflow, /sourceFor\('\$grainline_order_refund_blocks_fulfillment\$'\)/u);
  assert.match(workflow, /assert\.equal\(row\.prosrc, sourceFor\(spec\[0\]\)\)/u);
  assert.match(workflow, /assert\.equal\(row\.acl, previousByIdentity/u);
  assert.match(workflow, /assert\.deepEqual\(posture\.rows, before\.posture\)/u);
  assert.match(workflow, /order-child-authority-catalog\.mjs/u);
  assert.match(workflow, /EXPECTED_ORDER_ITEM_RLS_FORCED: "true"/u);
  assert.match(workflow, /EXPECTED_ORDER_QUOTE_RLS_FORCED: "true"/u);
});

test("workflow cannot deploy the app or invoke payment and shipping providers", () => {
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(
    workflow,
    /stripe\s+(?:charges|transfers|refunds|events)/iu,
  );
  assert.doesNotMatch(workflow, /shippo\s+(?:transaction|shipment|refund)/iu);
  assert.equal(
    (workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/u);
  assert.doesNotMatch(migration, /CREATE POLICY/u);
  assert.doesNotMatch(migration, /ALTER TABLE/u);
});
