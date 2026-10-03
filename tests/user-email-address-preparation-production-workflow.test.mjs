import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-email-address-preparation-production.yml",
  "utf8",
);

test("UserEmailAddress preparation is exact-main, CI-bound, restart-aware, and evidence-backed", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-user-email-address-preparation'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /main\.commit\.sha !== sha/);
  assert.match(workflow, /run\.name !== 'CI'/);
  assert.match(workflow, /run\.event !== 'push'/);
  assert.match(workflow, /run\.head_sha !== sha/);
  assert.match(workflow, /run\.conclusion !== 'success'/);
  assert.match(workflow, /guard-production-migration-runner\.mjs/);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+RUNNER_TEMP:/);
  assert.match(
    workflow,
    /USER_EMAIL_ADDRESS_INSPECT_EVIDENCE_PATH: \$\{\{ runner\.temp \}\}\/user-email-address-production-inspection-/,
  );
  assert.match(workflow, /mkdir -m 700 "\$\{\{ runner\.temp \}\}\/pre"/);
  assert.match(workflow, /mkdir -m 700 "\$\{\{ runner\.temp \}\}\/post"/);
  assert.match(
    workflow,
    /mv "\$USER_EMAIL_ADDRESS_INSPECT_EVIDENCE_PATH" "\$\{\{ runner\.temp \}\}\/pre\/"/,
  );
  assert.match(
    workflow,
    /mv "\$USER_EMAIL_ADDRESS_INSPECT_EVIDENCE_PATH" "\$\{\{ runner\.temp \}\}\/post\/"/,
  );

  for (const [digest, migration] of [
    ["3f2e6061e1de1a6f6c92645979a686ec4d3ee36409dc4499c2c62c90dafe1cf8", "20261002160000_add_user_email_suppression_key_index"],
    ["a4b247ce83e871f657ee8228873c3113bdc5cf58adb7292a2e90206c147f67a8", "20261002161000_add_user_email_address_suppression_key_index"],
    ["02ccc97c9e4d1e48320b58bd7ccc23aa023b7330d0add6fcf76802cc266f567c", "20261002162000_add_user_email_address_current_unique_index"],
    ["4b058ca847eac24428f8bd4733ed81fed26c6aa138437740e18c58da80bb2933", "20261002170000_prepare_user_email_address_authority"],
    ["b64751439f75fce70850ab43446c35ce6df45301b2a03970b560306898df1f2e", "20261003010000_repair_user_email_address_current_history"],
  ]) {
    assert.match(workflow, new RegExp(`${digest}[\\s\\S]*${migration}|${migration}[\\s\\S]*${digest}`));
  }

  assert.match(workflow, /state, \/\^\(\?:00000\|10000\|11000\|11100\|11110\|11111\)\$\//);
  assert.match(workflow, /applied prefix/);
  assert.match(workflow, /activeUsersWithoutCurrentRow, state === '11111' \? 0 : 1/);
  assert.match(workflow, /steps\.ledger\.outputs\.state != '11111'/);
  assert.match(workflow, /name: Prove no unrelated migration is pending/);
  assert.match(workflow, /PREPARATION_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/);
  assert.match(workflow, /if \[\[ "\$\{PREPARATION_STATE:index:1\}" == "0" \]\]/);
  assert.match(workflow, /npx prisma migrate status[\s\S]*name: Apply only the reviewed/);
  assert.match(workflow, /npx prisma migrate deploy/);
  assert.match(workflow, /currentHistoryDriftPresent, false/);
  assert.match(workflow, /supportingIndexesPresent, true/);
  assert.match(workflow, /preparedAuthorityFunctionCount, 4/);
  for (const value of [
    "User_active_email_suppression_key_idx",
    "UserEmailAddress_current_suppression_key_idx",
    "UserEmailAddress_one_current_per_user_key",
    "grainline_user_email_address_delete_for_current_user",
    "grainline_user_email_address_newer_current_claim",
    "grainline_user_email_address_owner_rows",
    "grainline_user_email_address_sync",
    "grainline_case_account_deletion_redact",
    "grainline_message_redact_for_account_deletion",
  ]) {
    assert.match(workflow, new RegExp(value));
  }
  assert.match(workflow, /index\.valid, true/);
  assert.match(workflow, /index\.ready, true/);
  assert.match(workflow, /index\.live, true/);
  assert.match(workflow, /entry\.security_definer, true/);
  assert.match(workflow, /entry\.contains_dynamic_execute, false/);
  assert.match(workflow, /grainline_app_runtime:EXECUTE:false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(workflow, /npx prisma migrate status/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /retention-days: 30/);
});
