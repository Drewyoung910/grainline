import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-seller-buyer-email-projection-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("buyer-email projection production workflow is manual, exact-main and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-order-seller-buyer-email-projection'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /actions\/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b/);
  assert.match(workflow, /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/);
});

test("workflow admits only the exact checksummed latest migration", () => {
  assert.match(workflow, /b9b0540de736daa01e8ac15f4fa41af3dd5ae8ffe4d5153aa2487a972b7b6c66\s+prisma\/migrations\/20260928213000_remove_seller_buyer_email_projection\/migration\.sql/);
  assert.match(workflow, /latest.*20260928213000_remove_seller_buyer_email_projection/);
  assert.match(workflow, /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed seller buyer-email projection migration/);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/);
});

test("postflight proves both email-free projections, grants, overlap and unchanged table posture", () => {
  assert.match(workflow, /grainline_order_seller_detail_v5\(text,text\)/);
  assert.match(workflow, /grainline_order_seller_recent_sales_v2\(text\)/);
  assert.match(workflow, /assert\.doesNotMatch\(row\.result_type, \/buyer_email\//);
  assert.match(workflow, /detail_v4: true, recent_v1: true/);
  assert.match(workflow, /assert\.deepEqual\(after\.rows, before\)/);
  assert.doesNotMatch(workflow, /provision-runtime-db-role\.sql/);
  assert.doesNotMatch(workflow, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/i);
});

test("CI isolates the projection during historical proofs and restores it after predecessors", () => {
  const verify = ciWorkflow.indexOf(
    "Verify Order seller buyer-email projection source package",
  );
  const isolate = ciWorkflow.indexOf(
    "Isolate Order seller buyer-email projection until predecessors pass",
  );
  const historical = ciWorkflow.indexOf(
    "Verify compatible Order checkout receipt authority release",
  );
  const labelApply = ciWorkflow.indexOf(
    "Apply only Order label sender-contact correction in disposable PostgreSQL",
  );
  const restore = ciWorkflow.indexOf(
    "Restore Order seller buyer-email projection",
  );
  const projectionApply = ciWorkflow.indexOf(
    "Apply only Order seller buyer-email projection in disposable PostgreSQL",
  );
  const build = ciWorkflow.indexOf("Production build");

  assert.ok(verify > 0 && verify < isolate);
  assert.ok(isolate < historical);
  assert.ok(historical < labelApply);
  assert.ok(labelApply < restore);
  assert.ok(restore < projectionApply);
  assert.ok(projectionApply < build);
  assert.match(
    ciWorkflow,
    /ORDER_SELLER_BUYER_EMAIL_PROJECTION_MIGRATION_PATH=\$correction\/migration\.sql/,
  );
  assert.match(
    ciWorkflow,
    /Restore Order deauthorized Case-access correction[\s\S]*ORDER_DEAUTHORIZED_CASE_ACCESS_MIGRATION_PATH=prisma\/migrations\/20260928010000_correct_order_deauthorized_case_access\/migration\.sql[\s\S]*Re-verify Order seller buyer-email projection source package/,
  );
});
