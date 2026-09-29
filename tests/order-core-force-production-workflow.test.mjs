import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-core-force-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("Core Order FORCE workflow is a separate exact protected release", () => {
  assert.match(workflow, /name: Core Order FORCE production \(protected\)/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'force-reviewed-core-order-rls'/u,
  );
  assert.match(workflow, /runtime_lock_run_id:/u);
  assert.match(
    workflow,
    /runtimeLock\.name !== 'Order Item and Shipping Quote Runtime Lock Production'/u,
  );
  assert.match(workflow, /github\.rest\.repos\.compareCommits/u);
  assert.match(workflow, /base: runtimeLock\.head_sha/u);
  assert.match(workflow, /head: sha/u);
  assert.match(
    workflow,
    /ancestry\.status !== 'ahead' && ancestry\.status !== 'identical'/u,
  );
  assert.match(workflow, /Verify live zero-direct application boundary/u);
  assert.match(
    workflow,
    /node scripts\/verify-order-email-free-deployment-surface\.mjs/u,
  );
  assert.match(workflow, /node scripts\/verify-order-core-force-release\.mjs/u);
  assert.match(workflow, /Apply only Core Order FORCE/u);
  assert.match(
    workflow,
    /steps\.force_scope\.outputs\.state == 'predecessor'/u,
  );
  assert.match(
    workflow,
    /Audit pre-FORCE runtime grants and global RLS catalog/u,
  );
  assert.match(
    workflow,
    /Audit post-FORCE runtime grants and global RLS catalog/u,
  );
  assert.doesNotMatch(
    workflow,
    /ALTER TABLE public\."Order" FORCE ROW LEVEL SECURITY/u,
  );
  assert.doesNotMatch(workflow, /DATABASE_URL:/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.ok(
    workflow.indexOf("Verify live zero-direct application boundary") <
      workflow.indexOf("Verify owner connection boundary"),
  );
});

test("Core Order FORCE workflow accepts only its exact latest migration", () => {
  assert.match(
    workflow,
    /latest.*prisma\/migrations\/20260929160000_force_order_rls/su,
  );
  assert.match(
    workflow,
    /20260929130000_revoke_order_item_shipping_quote_runtime_access/u,
  );
  assert.match(
    workflow,
    /1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139/u,
  );
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only Core Order FORCE/u,
  );
  assert.match(workflow, /enabled: true, forced: state === 'restart'/u);
  assert.match(workflow, /enabled: true, forced: true, policy_count: 0/u);
  assert.equal((workflow.match(/invalid_acl_count: 0/gu) ?? []).length, 4);
  assert.ok(
    workflow.indexOf("Audit pre-FORCE runtime grants and global RLS catalog") <
      workflow.indexOf("Apply only Core Order FORCE"),
  );
  assert.ok(
    workflow.indexOf("Apply only Core Order FORCE") <
      workflow.indexOf(
        "Audit post-FORCE runtime grants and global RLS catalog",
      ),
  );
});

test("CI keeps Core Order FORCE isolated until the runtime lock passes", () => {
  const verify = ciWorkflow.indexOf(
    "Verify staged Core Order FORCE source package",
  );
  const isolate = ciWorkflow.indexOf(
    "Isolate Core Order FORCE until runtime-lock predecessors pass",
  );
  const runtimeLockAudit = ciWorkflow.indexOf(
    "Audit locked Order item and quote runtime grants",
  );
  const restore = ciWorkflow.indexOf("Restore Core Order FORCE release");
  const forceApply = ciWorkflow.indexOf(
    "Apply only Core Order FORCE through Prisma",
  );
  const forceAudit = ciWorkflow.indexOf(
    "Audit FORCE-hardened Core Order runtime grants",
  );
  const build = ciWorkflow.indexOf("Production build");
  assert.ok(verify > 0 && verify < isolate);
  assert.ok(isolate < runtimeLockAudit);
  assert.ok(runtimeLockAudit < restore);
  assert.ok(restore < forceApply);
  assert.ok(forceApply < forceAudit);
  assert.ok(forceAudit < build);
});
