import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";

import { USER_AUTHORITY_GROUPS } from "../scripts/user-authority-catalog.mjs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationName = "20261007030000_prepare_user_block_email_authorities";
const functionIdentities = [
  "grainline_user_block_targets()",
  "grainline_user_blocked_account_page()",
  "grainline_user_block_pair_lock(text)",
  "grainline_user_email_fallback_addresses()",
];

describe("User block and email authority source boundary", () => {
  it("defines four context-bound fixed-path runtime authorities without changing RLS posture", () => {
    const migration = read(`prisma/migrations/${migrationName}/migration.sql`);

    assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 4);
    assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 4);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 4);
    assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length, 4);
    assert.equal((migration.match(/current_setting\('app\.user_id', true\)/g) ?? []).length, 4);
    assert.match(migration, /current_setting\('transaction_isolation'\) <> 'read committed'/);
    assert.match(migration, /ORDER BY account_user\.id\s+FOR UPDATE/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/);
    assert.doesNotMatch(migration, /CREATE POLICY|ALTER POLICY/);
  });

  it("keeps the callable catalog and canonical provisioning exact", () => {
    const group = USER_AUTHORITY_GROUPS.find(({ migration }) => migration === migrationName);
    const provisioning = read("scripts/provision-runtime-db-role.sql");

    assert.deepEqual(
      group?.functions.map(({ identity, runtimeExecute }) => ({ identity, runtimeExecute })),
      functionIdentities.map((identity) => ({ identity, runtimeExecute: true })),
    );
    for (const identity of functionIdentities) {
      const quotedIdentity = `public.\"${identity.replace("(", "\"(")}`;
      assert.equal(
        provisioning.split(quotedIdentity).length - 1,
        2,
        `${identity} should appear once in revoke convergence and once in grant convergence`,
      );
    }
  });

  it("moves block identity reads and pair locking behind owner context", () => {
    const blocks = read("src/lib/blocks.ts");
    const mutations = read("src/lib/blockMutationAccess.ts");
    const page = read("src/app/account/blocked/page.tsx");

    assert.match(blocks, /withDbUserContext/);
    assert.match(blocks, /grainline_user_block_targets\(\)/);
    assert.match(blocks, /grainline_user_blocked_account_page\(\)/);
    assert.doesNotMatch(blocks, /prisma\.(?:user|block)\./);
    assert.match(mutations, /withDbUserContext\(blockerId/);
    assert.match(mutations, /grainline_user_block_pair_lock\(\$\{blockedId\}::text\)/);
    assert.match(mutations, /TransactionIsolationLevel\.ReadCommitted/);
    assert.doesNotMatch(mutations, /(?:tx|prisma)\.user\./);
    assert.match(page, /getBlockedAccountsFor\(me\.id\)/);
    assert.doesNotMatch(page, /prisma\.block\./);
  });

  it("keeps email-history fallback owner-scoped and argument-free", () => {
    const emailAccess = read("src/lib/userEmailAddresses.ts");
    const ownerAccess = read("src/lib/userEmailAddressOwnerAccess.ts");
    const accountExport = read("src/app/api/account/export/route.ts");
    const deletion = read("src/lib/accountDeletion.ts");

    assert.match(emailAccess, /grainline_user_email_fallback_addresses\(\)/);
    assert.match(
      emailAccess,
      /accountEmailFallbackEmailsForUser\(\s*client: UserEmailOwnerClient,\s*\)/,
    );
    assert.match(ownerAccess, /withDbUserContext\(\s*userId/);
    assert.match(accountExport, /ownerAccountEmailFallbackEmails\(user\.id\)/);
    assert.match(deletion, /accountEmailFallbackEmailsForUser\(tx\)/);
  });

  it("stages the package after public review-commission and accumulated access", () => {
    const workflow = read(".github/workflows/ci.yml");
    assert.doesNotThrow(() => yaml.load(workflow, { schema: yaml.JSON_SCHEMA }));

    const isolate = workflow.indexOf("name: Isolate User block-email package until its predecessor passes");
    const predecessorAudit = workflow.indexOf("name: Audit runtime grants after User public review-commission snapshot");
    const restore = workflow.indexOf("name: Restore User block-email source package");
    const apply = workflow.indexOf("name: Apply User block-email authorities in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User block-email authority catalog");
    const audit = workflow.indexOf("name: Audit runtime grants after User block-email authorities");
    const accumulatedRestore = workflow.indexOf("name: Restore accumulated User access source package");
    const accumulatedAudit = workflow.indexOf("name: Audit runtime grants after accumulated User access");
    const build = workflow.indexOf("name: Production build");
    for (const position of [
      isolate,
      predecessorAudit,
      accumulatedRestore,
      accumulatedAudit,
      restore,
      apply,
      catalog,
      audit,
      build,
    ]) {
      assert.notEqual(position, -1);
    }
    assert.ok(isolate < predecessorAudit);
    assert.ok(predecessorAudit < accumulatedRestore);
    assert.ok(accumulatedRestore < accumulatedAudit);
    assert.ok(accumulatedAudit < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < audit);
    assert.ok(audit < build);
  });
});
