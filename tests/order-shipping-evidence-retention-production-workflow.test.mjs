import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/order-shipping-evidence-retention-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261002030000_preserve_order_shipping_dispute_evidence/migration.sql",
  "utf8",
);

test("shipping-evidence retention workflow parses and inline programs compile", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.apply.environment, "Production");

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

test("workflow is manual, exact-main, successful-CI and Production bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-order-shipping-evidence-retention'/u,
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

test("workflow admits only the exact latest migration after exact continuity", () => {
  assert.match(
    workflow,
    /a648437f13d93e1673f64935d381630e6ec2b19e7633c33837e88938240ef5c7\s+prisma\/migrations\/20261002030000_preserve_order_shipping_dispute_evidence\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /tail -n 1[\s\S]*20261002030000_preserve_order_shipping_dispute_evidence/u,
  );
  assert.match(
    workflow,
    /20261002020000_correct_case_refund_provider_recovery_continuity/u,
  );
  assert.match(
    workflow,
    /dad13cbbaf2de845c591c0f8000a21d5d19ba7c19ccf61c9179ca92b4524a8ce/u,
  );
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed shipping-evidence retention migration/u,
  );
});

test("CI isolates and restores the successor after accepted predecessors", () => {
  const verify = ci.indexOf("Verify shipping-evidence retention source package");
  const isolate = ci.indexOf(
    "Isolate shipping-evidence retention until every predecessor passes",
  );
  const continuity = ci.indexOf(
    "Apply Case refund provider continuity successor in disposable PostgreSQL",
  );
  const restore = ci.indexOf("Restore shipping-evidence retention successor");
  const apply = ci.indexOf(
    "Apply shipping-evidence retention successor in disposable PostgreSQL",
  );
  assert.ok(verify >= 0);
  assert.ok(isolate > verify);
  assert.ok(continuity > isolate);
  assert.ok(restore > continuity);
  assert.ok(apply > restore);
  assert.match(ci, /Verify exact Order child catalog after shipping-evidence retention/u);
});

test("workflow proves exact function, ACL and unchanged table posture", () => {
  assert.match(workflow, /26fa4de85784ae8b1fb4b509004be06768c879dbd5e3b459dac5a858edd12a08/u);
  assert.match(workflow, /4f91bdb5df181632a3b72766987279fae04319b325f10a0ee332adb1ec05f483/u);
  assert.match(workflow, /84195010343f715d2568edcff1c0ccf2ff40a98de0991088089df2269510eda1/u);
  assert.match(workflow, /public\.grainline_order_account_deletion_blockers\(text\)/u);
  assert.match(workflow, /public\.grainline_order_staff_mark_reviewed\(text,text\)/u);
  assert.match(workflow, /'OrderDisputeRecovery'/u);
  assert.match(
    workflow,
    /createHash\('sha256'\)\.update\(routine\.prosrc\)[\s\S]*candidate \? spec\.successor : spec\.predecessor/u,
  );
  assert.match(workflow, /prosrc: expectedSource\(spec\.name\)/u);
  assert.match(
    workflow,
    /acl: \['grainline_staff_read_runtime:EXECUTE:false'\]/u,
  );
  assert.match(workflow, /assert\.equal\(posture\.rows\.length, 4\)/u);
  assert.match(workflow, /assert\.deepEqual\(posture\.rows, postureBefore\)/u);
  assert.match(workflow, /order-child-authority-catalog\.mjs/u);
});

test("release changes neither RLS posture nor deployment/provider state", () => {
  assert.equal(
    (workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(workflow, /stripe\s+(?:charges|refunds|disputes)/iu);
  assert.doesNotMatch(workflow, /shippo\s+(?:transaction|shipment|refund)/iu);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY/u);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/u);
});
