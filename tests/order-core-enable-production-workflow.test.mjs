import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-core-enable-production.yml", "utf8",
);

test("Core Order ENABLE workflow is a separate exact protected release", () => {
  assert.match(workflow, /name: Core Order ENABLE production \(protected\)/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /environment: Production/);
  assert.match(
    workflow,
    /uses: actions\/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7/,
  );
  assert.match(workflow, /inputs\.confirmation == 'enable-reviewed-core-order-rls'/);
  assert.match(workflow, /cutoverValue !== '36330287044'/);
  assert.match(workflow, /cutover\.head_sha !== '5a073252b55bd940210b57db58dcf27ab9dfb8b1'/);
  assert.match(workflow, /node scripts\/verify-order-core-enable-release\.mjs/);
  assert.match(workflow, /Apply only Core Order ENABLE and direct-grant revocation/);
  assert.match(workflow, /steps\.enable_scope\.outputs\.state == 'predecessor'/);
  assert.match(workflow, /Audit post-ENABLE runtime grants and global RLS catalog/);
  assert.doesNotMatch(workflow, /FORCE ROW LEVEL SECURITY|force_order_rls/);
  assert.doesNotMatch(workflow, /DATABASE_URL:/);
});
