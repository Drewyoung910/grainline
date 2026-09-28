import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/order-case-corrections-production.yml",
  "utf8",
);

test("Production Case correction workflow is exact-main and approval bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-order-case-corrections'/u,
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

test("workflow admits only the exact two checksummed corrections and restart prefix", () => {
  assert.match(
    workflow,
    /49741a79b470b22bb236510795bf0659be32f6a2dfb88b81fa9106cf3b8c31bf\s+prisma\/migrations\/20260901161000_correct_case_staff_refund_label_claim\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /a92fbcbc6c809e51a14cf53c7b98958693c327040565a64929c4527ff56b112f\s+prisma\/migrations\/20260928010000_correct_order_deauthorized_case_access\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /rows\.size === 0 \|\| rows\.size === 1 \|\| rows\.size === 2/u,
  );
  assert.match(
    workflow,
    /if \(rows\.size === 1\) assert\.ok\(rows\.has\(first\)\)/u,
  );
  assert.match(
    workflow,
    /predecessor[\s\S]*restart_after_refund_label[\s\S]*restart_complete/u,
  );
  assert.match(
    workflow,
    /Isolate reviewed corrections and require no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Case corrections/u,
  );
});

test("postflight pins function bodies, runtime grants, and unchanged Core Order posture", () => {
  for (const digest of [
    "1f2786a3676e23af23848fab06e829a69bc7cd51bc25274e5569d9f5bc21c5a9",
    "2b70cb728df1471f68ebf63b98489d33c4b3de56a9250ad3b87e01a1133851d6",
    "601c16ca75b6da9d251b88d81c83e69df0568d0f56ffea870122e1c5be0f4e31",
    "e5d15680f411f9e0de3233b4d2c48b5e0f00fe682337f8652d3a5ed95ecffc9e",
  ]) {
    assert.match(workflow, new RegExp(digest, "u"));
  }
  assert.match(workflow, /provision-runtime-db-role\.sql/u);
  assert.match(workflow, /row\.runtime_execute, true/u);
  assert.match(workflow, /row\.public_execute, false/u);
  assert.match(workflow, /rls_enabled: true/u);
  assert.match(workflow, /force_enabled: false/u);
  assert.match(workflow, /runtime_select: false/u);
  assert.match(workflow, /policy_count: 0/u);
});
