import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-seller-email-projection-predecessor-retirement-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("retirement workflow is manual, exact-main, live-deployment and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /production_deployment_id:/);
  assert.match(workflow, /inputs\.confirmation == 'retire-reviewed-order-seller-email-projection-predecessors'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /main\.commit\.sha !== sha[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/);
});

test("workflow admits only the exact checksummed latest retirement migration", () => {
  assert.match(workflow, /3a1f173fac0293ec05c43b44e9cd2a6895dcdd47effce55236e7e7c7a55fb799\s+prisma\/migrations\/20260928220000_retire_seller_buyer_email_projection_predecessors\/migration\.sql/);
  assert.match(workflow, /latest.*20260928220000_retire_seller_buyer_email_projection_predecessors/);
  assert.match(workflow, /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed seller email-projection predecessor retirement/);
});

test("postflight proves only predecessor grants changed and RLS posture stayed fixed", () => {
  for (const name of [
    "grainline_order_seller_detail_v2",
    "grainline_order_seller_detail_v3",
    "grainline_order_seller_detail_v4",
    "grainline_order_seller_recent_sales",
    "grainline_order_seller_detail_v5",
    "grainline_order_seller_recent_sales_v2",
  ]) assert.match(workflow, new RegExp(name));
  assert.match(workflow, /assert\.deepEqual\(definitions\.rows, before\.definitions\)/);
  assert.match(workflow, /assert\.deepEqual\(posture\.rows, before\.posture\)/);
  assert.doesNotMatch(workflow, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/i);
});

test("CI holds retirement until the email-free successor has been applied", () => {
  const verify = ciWorkflow.indexOf(
    "Verify Order seller email-projection predecessor retirement source package",
  );
  const isolate = ciWorkflow.indexOf(
    "Isolate Order seller email-projection predecessor retirement until its successor is proven",
  );
  const successorApply = ciWorkflow.indexOf(
    "Apply only Order seller buyer-email projection in disposable PostgreSQL",
  );
  const restore = ciWorkflow.indexOf(
    "Restore Order seller email-projection predecessor retirement",
  );
  const retirementApply = ciWorkflow.indexOf(
    "Apply only Order seller email-projection predecessor retirement in disposable PostgreSQL",
  );
  const build = ciWorkflow.indexOf("Production build");
  assert.ok(verify > 0 && verify < isolate);
  assert.ok(isolate < successorApply);
  assert.ok(successorApply < restore);
  assert.ok(restore < retirementApply);
  assert.ok(retirementApply < build);
  assert.match(ciWorkflow, /ORDER_SELLER_EMAIL_PROJECTION_RETIREMENT_MIGRATION_PATH=\$correction\/migration\.sql/);
});
