import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-label-sender-contact-production.yml",
  "utf8",
);

test("sender-contact production workflow is manual, exact-main and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-order-label-sender-contact'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /actions\/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b/);
  assert.match(workflow, /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/);
});

test("workflow admits only the exact checksummed latest migration", () => {
  assert.match(workflow, /33a6d19fd0e50345bab11fa4c1a5a686aa72768d96db2a4cb9bce80ec7cd521b\s+prisma\/migrations\/20260928020000_correct_order_label_sender_contact\/migration\.sql/);
  assert.match(workflow, /latest.*20260928020000_correct_order_label_sender_contact/);
  assert.match(workflow, /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed sender-contact migration/);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/);
});

test("postflight proves the new column, function grant and unchanged table posture", () => {
  assert.match(workflow, /SellerProfile_shipFromPhone_e164_check/);
  assert.match(workflow, /grainline_order_seller_label_preflight\(text,text\)/);
  assert.match(workflow, /runtime_execute, true/);
  assert.match(workflow, /public_execute, false/);
  assert.match(workflow, /assert\.deepEqual\(after\.rows\[0\], before\)/);
  assert.doesNotMatch(workflow, /provision-runtime-db-role\.sql/);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/i);
});
