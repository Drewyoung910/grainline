import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/seller-payout-event-authority-production.yml",
  "utf8",
);

test("dedicated payout runner binds exact main CI and same-commit inspection", () => {
  assert.match(workflow, /permissions:\s*\n\s*actions: read\s*\n\s*contents: read/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /releaseCommit !== context\.sha/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(
    workflow,
    /name: 'CI'[\s\S]*event: 'push'[\s\S]*headBranch: 'main'/,
  );
  assert.match(
    workflow,
    /name: 'Order Payment Shipping Legacy Inspection'[\s\S]*event: 'workflow_dispatch'[\s\S]*headBranch: 'main'/,
  );
  assert.match(workflow, /apply-reviewed-seller-payout-event-authority/);
});

test("runner proves exact restart and after scopes around one compatible migration", () => {
  const restart = workflow.indexOf(
    "SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGE: restart",
  );
  const apply = workflow.indexOf("npx prisma migrate deploy");
  const status = workflow.indexOf("npx prisma migrate status");
  const audit = workflow.indexOf("npm run audit:db-grants -- --require-direct-url");
  const after = workflow.indexOf(
    "SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGE: after",
  );
  assert.ok(restart >= 0);
  assert.ok(apply > restart);
  assert.ok(status > apply);
  assert.ok(audit > status);
  assert.ok(after > audit);
  assert.match(workflow, /if: steps\.scope\.outputs\.state == 'predecessor'/);
  assert.match(workflow, /\["predecessor", "prepared"\]/);
  assert.match(
    workflow,
    /audit:rls-seller-payout-event-authority-release/,
  );
  assert.match(
    workflow,
    /audit:rls-checkout-stock-reservation-force-release/,
  );
  assert.doesNotMatch(workflow, /provision-runtime-db-role/);
});

test("runner does not activate RLS, deploy, clean data, or change providers", () => {
  assert.doesNotMatch(workflow, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(workflow, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(workflow, /enable_seller_payout_event_rls/);
  assert.doesNotMatch(workflow, /vercel|stripe\s+(?:endpoint|account)|cleanup|DELETE FROM/i);
  assert.doesNotMatch(workflow, /secrets\.[A-Z_]*(?:STRIPE|VERCEL|CLERK)/);
});
