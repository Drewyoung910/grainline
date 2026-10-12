import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const preparation = "20261011170000_prepare_account_deletion_side_effect_claim_fence";
const mediaKey = "20261011173000_prepare_account_deletion_media_key_fence";
const activation = "20261011180000_enable_account_deletion_side_effect_rls";
const packageTests = [
  "account-deletion-side-effect-ci.test.mjs",
  "account-deletion-side-effect-activation-postgres.test.mjs",
  "account-deletion-side-effect-database-contract.test.mjs",
  "account-deletion-side-effect-production-inspect.test.mjs",
  "account-deletion-side-effect-production-workflows.test.mjs",
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
  const applyMediaKey = "Apply AccountDeletionSideEffect media-key fence in disposable PostgreSQL";
  const applyActivation = "Apply AccountDeletionSideEffect policyless activation in disposable PostgreSQL";
  const stageActivationLedger = "Stage exact AccountDeletionSideEffect ledgers for integrated proof";
  const audit = "Audit runtime grants after AccountDeletionSideEffect activation";

  assert.ok(workflow.indexOf(verify) < workflow.indexOf(isolate));
  assert.ok(workflow.indexOf(isolate) < workflow.indexOf("Verify accumulated User access source package"));
  assert.ok(workflow.indexOf(restore) > workflow.indexOf("Audit runtime grants after Clerk webhook event authority"));
  assert.ok(workflow.indexOf(restore) < workflow.indexOf(reverify));
  assert.ok(workflow.indexOf(reverify) < workflow.indexOf(applyPreparation));
  assert.ok(workflow.indexOf(applyPreparation) < workflow.indexOf(applyMediaKey));
  assert.ok(workflow.indexOf(applyMediaKey) < workflow.indexOf(applyActivation));
  assert.ok(workflow.indexOf(applyActivation) < workflow.indexOf(stageActivationLedger));
  assert.ok(workflow.indexOf(stageActivationLedger) < workflow.indexOf(audit));
  assert.ok(workflow.indexOf(audit) < workflow.indexOf("Production build"));

  for (const migration of [preparation, mediaKey, activation]) {
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
  assert.match(
    step(applyMediaKey),
    new RegExp(`--file=prisma/migrations/${mediaKey}/migration\\.sql`),
  );
  for (const name of [applyPreparation, applyMediaKey, applyActivation]) {
    assert.match(step(name), /psql "\$DIRECT_URL"/);
    assert.match(step(name), /--set=ON_ERROR_STOP=on/);
    assert.doesNotMatch(step(name), /gh |vercel|workflow_dispatch|environment: Production/);
  }
  assert.match(
    step(stageActivationLedger),
    /ACCOUNT_DELETION_SIDE_EFFECT_ACTIVATION_MIGRATION_SHA256/,
  );
  assert.match(
    step(stageActivationLedger),
    /ACCOUNT_DELETION_CLAIM_FENCE_PREPARATION_MIGRATION_SHA256/,
  );
  assert.match(
    step(stageActivationLedger),
    /ACCOUNT_DELETION_MEDIA_KEY_PREPARATION_MIGRATION_SHA256/,
  );
  assert.match(step(stageActivationLedger), /INSERT INTO public\._prisma_migrations/);
  assert.match(step(stageActivationLedger), /'account-deletion-claim-fence-proof'/);
  assert.match(step(stageActivationLedger), /'account-deletion-media-key-proof'/);
  assert.match(step(stageActivationLedger), /'account-deletion-rls-proof'/);
  assert.ok("account-deletion-claim-fence-proof".length <= 36);
  assert.ok("account-deletion-media-key-proof".length <= 36);
  assert.ok("account-deletion-rls-proof".length <= 36);
  assert.doesNotMatch(
    step(stageActivationLedger),
    /gh |vercel|workflow_dispatch|environment: Production/,
  );
});
