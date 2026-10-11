import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const preparation = "20261011170000_prepare_account_deletion_side_effect_claim_fence";
const activation = "20261011180000_enable_account_deletion_side_effect_rls";
const packageTests = [
  "account-deletion-side-effect-ci.test.mjs",
  "account-deletion-side-effect-activation-postgres.test.mjs",
  "account-deletion-side-effect-database-contract.test.mjs",
  "account-deletion-side-effects.test.mjs",
];

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, next < 0 ? undefined : next);
}

test("AccountDeletionSideEffect claim-fence is isolated until every predecessor replays", () => {
  const verify = "Verify AccountDeletionSideEffect claim-fence source package";
  const isolate = "Isolate AccountDeletionSideEffect claim-fence until its predecessors pass";
  const restore = "Restore AccountDeletionSideEffect claim-fence source package";
  const reverify = "Re-verify AccountDeletionSideEffect claim-fence source package";
  const applyPreparation = "Apply AccountDeletionSideEffect claim-fence preparation in disposable PostgreSQL";
  const applyActivation = "Apply AccountDeletionSideEffect policyless activation in disposable PostgreSQL";
  const audit = "Audit runtime grants after AccountDeletionSideEffect activation";

  assert.ok(workflow.indexOf(verify) < workflow.indexOf(isolate));
  assert.ok(workflow.indexOf(isolate) < workflow.indexOf("Verify accumulated User access source package"));
  assert.ok(workflow.indexOf(restore) > workflow.indexOf("Audit runtime grants after Clerk webhook event authority"));
  assert.ok(workflow.indexOf(restore) < workflow.indexOf(reverify));
  assert.ok(workflow.indexOf(reverify) < workflow.indexOf(applyPreparation));
  assert.ok(workflow.indexOf(applyPreparation) < workflow.indexOf(applyActivation));
  assert.ok(workflow.indexOf(applyActivation) < workflow.indexOf(audit));
  assert.ok(workflow.indexOf(audit) < workflow.indexOf("Production build"));

  for (const migration of [preparation, activation]) {
    assert.ok(step(isolate).includes(migration), `${isolate}: ${migration}`);
    assert.ok(step(restore).includes(migration), `${restore}: ${migration}`);
  }
  for (const file of packageTests) {
    assert.ok(step(verify).includes(file), `${verify}: ${file}`);
    assert.ok(step(isolate).includes(file), `${isolate}: ${file}`);
    assert.ok(step(reverify).includes(file), `${reverify}: ${file}`);
    assert.ok(step(restore).includes(file), `${restore}: ${file}`);
  }

  assert.match(
    step(applyPreparation),
    new RegExp(`--file=prisma/migrations/${preparation}/migration\\.sql`),
  );
  assert.match(
    step(applyActivation),
    new RegExp(`--file=prisma/migrations/${activation}/migration\\.sql`),
  );
  for (const name of [applyPreparation, applyActivation]) {
    assert.match(step(name), /psql "\$DIRECT_URL"/);
    assert.match(step(name), /--set=ON_ERROR_STOP=on/);
    assert.doesNotMatch(step(name), /gh |vercel|workflow_dispatch|environment: Production/);
  }
});
