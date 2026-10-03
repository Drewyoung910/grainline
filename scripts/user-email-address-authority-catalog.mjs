#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  readUserEmailAddressCatalog,
  verifyUserEmailAddressCatalog,
} from "./user-email-address-production-inspect.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_case_account_deletion_redact",
    identityArguments: "p_account_deletion_side_effect_id text",
    sourceMd5: "b9e24ec8efa43b689b357f4965f8e722",
    volatility: "v",
  }),
  Object.freeze({
    name: "grainline_message_redact_for_account_deletion",
    identityArguments: "p_actor_id text",
    sourceMd5: "e19c1b6b5b3adf968df8e2acab8851df",
    volatility: "v",
  }),
  Object.freeze({
    name: "grainline_user_email_address_delete_for_current_user",
    identityArguments: "",
    sourceMd5: "d570b850599eafe3629aa8240fe8c6d7",
    volatility: "v",
  }),
  Object.freeze({
    name: "grainline_user_email_address_newer_current_claim",
    identityArguments:
      "p_suppression_keys text[], p_issued_at timestamp without time zone",
    sourceMd5: "873863dc1595a6fa738c9f5f31e5cb0b",
    volatility: "s",
  }),
  Object.freeze({
    name: "grainline_user_email_address_owner_rows",
    identityArguments: "",
    sourceMd5: "d8c04787918ab4aafa1b630757cca39c",
    volatility: "s",
  }),
  Object.freeze({
    name: "grainline_user_email_address_sync",
    identityArguments: "p_user_id text, p_current_email text, p_source text",
    sourceMd5: "04d09b22c99b0ce62ef2acdc16167c20",
    volatility: "v",
  }),
]);

export const USER_EMAIL_ADDRESS_REQUIRED_INDEXES = Object.freeze([
  "UserEmailAddress_current_suppression_key_idx",
  "UserEmailAddress_email_idx",
  "UserEmailAddress_one_current_per_user_key",
  "UserEmailAddress_pkey",
  "UserEmailAddress_userId_email_key",
  "UserEmailAddress_userId_isCurrent_idx",
]);

function exactArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

export function userEmailAddressExpectedPostureFromEnvironment(
  environment = process.env,
) {
  const requiredBoolean = (name) => {
    const value = environment[name];
    assert.ok(
      value === "true" || value === "false",
      `${name} must be true or false`,
    );
    return value === "true";
  };
  return Object.freeze({
    rlsEnabled: requiredBoolean("EXPECTED_USER_EMAIL_ADDRESS_RLS_ENABLED"),
    rlsForced: requiredBoolean("EXPECTED_USER_EMAIL_ADDRESS_RLS_FORCED"),
    runtimeDirectCrud: requiredBoolean(
      "EXPECTED_USER_EMAIL_ADDRESS_RUNTIME_DIRECT_CRUD",
    ),
  });
}

export function verifyUserEmailAddressAuthorityCatalog(
  catalog,
  expected = Object.freeze({
    rlsEnabled: false,
    rlsForced: false,
    runtimeDirectCrud: true,
  }),
) {
  const base = verifyUserEmailAddressCatalog(catalog);
  const runtimeCrudValues = Object.values(base.runtimeCrud);
  const runtimeDirectCrud = runtimeCrudValues.every(Boolean)
    ? true
    : runtimeCrudValues.every((value) => !value)
      ? false
      : "mixed";
  assert.deepEqual(
    {
      rlsEnabled: base.rlsEnabled,
      rlsForced: base.rlsForced,
      runtimeDirectCrud,
    },
    expected,
    "UserEmailAddress table posture drifted",
  );
  assert.equal(base.policyCount, 0, "UserEmailAddress must remain policyless");
  assert.equal(
    base.counts.duplicateCurrentUserGroups,
    0,
    "UserEmailAddress duplicate-current groups remain",
  );
  assert.equal(
    base.counts.currentRowsWithoutMatchingActiveUser,
    0,
    "UserEmailAddress current row lacks an active exact owner",
  );
  assert.equal(
    base.counts.activeUsersWithoutCurrentRow,
    0,
    "UserEmailAddress active owner lacks a current row",
  );
  assert.equal(
    base.supportingIndexesPresent,
    true,
    "UserEmailAddress supporting indexes are missing",
  );

  const indexes = (catalog.indexes ?? [])
    .filter((entry) => entry.table_name === "UserEmailAddress")
    .sort((left, right) => left.index_name.localeCompare(right.index_name));
  assert.deepEqual(
    indexes.map((entry) => entry.index_name),
    [...USER_EMAIL_ADDRESS_REQUIRED_INDEXES],
    "UserEmailAddress index inventory drifted",
  );
  assert.equal(
    indexes.every((entry) => entry.valid && entry.ready && entry.live),
    true,
    "UserEmailAddress has an invalid, unready, or non-live index",
  );

  const functions = [...(catalog.functions ?? [])].sort((left, right) =>
    left.function_name.localeCompare(right.function_name),
  );
  assert.equal(functions.length, USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS.length);
  for (const [
    index,
    expectedFunction,
  ] of USER_EMAIL_ADDRESS_AUTHORITY_FUNCTIONS.entries()) {
    const actual = functions[index];
    assert.equal(actual?.function_name, expectedFunction.name);
    assert.equal(actual.identity_arguments, expectedFunction.identityArguments);
    assert.equal(actual.owner_name, "neondb_owner");
    assert.equal(actual.language_name, "plpgsql");
    assert.equal(actual.function_kind, "f");
    assert.equal(actual.security_definer, true);
    assert.equal(actual.leakproof, false);
    assert.equal(actual.volatility, expectedFunction.volatility);
    assert.equal(actual.parallel_safety, "u");
    assert.equal(actual.source_md5, expectedFunction.sourceMd5);
    assert.equal(actual.contains_dynamic_execute, false);
    assert.equal(
      exactArray(actual.function_config, ["search_path=pg_catalog"]),
      true,
      `${expectedFunction.name} configuration drifted`,
    );
    assert.equal(
      exactArray(actual.nonowner_acl, ["grainline_app_runtime:EXECUTE:false"]),
      true,
      `${expectedFunction.name} ACL drifted`,
    );
  }

  const triggers = catalog.triggers ?? [];
  assert.equal(triggers.length, 2, "UserEmailAddress trigger count drifted");
  assert.equal(
    triggers.every(
      (trigger) =>
        trigger.internal &&
        trigger.enabled === "O" &&
        ["RI_FKey_check_ins", "RI_FKey_check_upd"].includes(
          trigger.function_name,
        ),
    ),
    true,
    "UserEmailAddress trigger posture drifted",
  );

  return Object.freeze({
    databaseMode: "owner-catalog-read-only",
    tableOwner: base.tableOwner,
    functionCount: functions.length,
    indexCount: indexes.length,
    policyCount: base.policyCount,
    rlsEnabled: base.rlsEnabled,
    rlsForced: base.rlsForced,
    runtimeDirectCrud: expected.runtimeDirectCrud,
    rowDataRead: false,
    productionChanged: false,
  });
}

async function main() {
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, "DIRECT_URL is required");
  assert.equal(
    Object.hasOwn(process.env, "DATABASE_URL"),
    false,
    "DATABASE_URL must remain absent from owner catalog inspection",
  );
  const parsedUrl = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-email-address-authority-catalog",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const catalog = await readUserEmailAddressCatalog(client);
    const result = verifyUserEmailAddressAuthorityCatalog(
      catalog,
      userEmailAddressExpectedPostureFromEnvironment(),
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify({ status: "passed", result })}\n`);
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
