import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migrationPath =
  "prisma/migrations/20261004020000_prepare_user_signed_unsubscribe_authorities/migration.sql";
const migration = source(migrationPath);

function functionBlock(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
}

describe("User signed-unsubscribe authorities", () => {
  it("defines two fixed runtime-only definer functions", () => {
    const names = [
      "grainline_user_unsubscribe_token_superseded",
      "grainline_user_unsubscribe_preferences_disable",
    ];
    assert.equal((migration.match(/^SECURITY DEFINER$/gmu) ?? []).length, 2);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gmu) ?? []).length, 2);
    for (const name of names) {
      const block = functionBlock(name);
      assert.match(block, /LANGUAGE plpgsql/);
      assert.match(block, /PARALLEL UNSAFE/);
      assert.doesNotMatch(block, /\bEXECUTE\b/);
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\(`));
      assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\(`));
    }
    assert.equal((migration.match(/FROM PUBLIC, grainline_app_runtime/gu) ?? []).length, 2);
    assert.equal((migration.match(/TO grainline_app_runtime/gu) ?? []).length, 2);
  });

  it("canonicalizes stored Gmail identities and preserves the prior supersession rules", () => {
    const block = functionBlock("grainline_user_unsubscribe_token_superseded");
    assert.match(block, /pg_catalog\.lower\(/);
    assert.match(block, /IN \('gmail\.com', 'googlemail\.com'\)/);
    assert.match(block, /pg_catalog\.replace\(/);
    assert.match(block, /pg_catalog\.split_part\([\s\S]*'\+',\s*1/);
    assert.match(block, /\|\| '@gmail\.com'/);
    assert.match(block, /account_user\."deletedAt" IS NULL[\s\S]*account_user\."createdAt" > p_issued_at/);
    assert.match(block, /account_user\."emailPreferenceOptInAt" > p_issued_at/);
    assert.match(block, /END = ANY \(p_suppression_keys\)/);
  });

  it("disables exactly the application email-preference keys while preserving other JSON", () => {
    const keySource = source("src/lib/notificationPreferenceKeys.ts");
    const emailBlock = keySource.match(
      /VALID_EMAIL_PREFERENCE_KEYS = \[([\s\S]*?)\] as const/u,
    )?.[1];
    assert.ok(emailBlock);
    const applicationKeys = [...emailBlock.matchAll(/"([A-Z0-9_]+)"/gu)]
      .map((match) => match[1]);
    const block = functionBlock("grainline_user_unsubscribe_preferences_disable");
    const disabledKeys = [...block.matchAll(/'([A-Z0-9_]+)', false/gu)]
      .map((match) => match[1]);
    assert.deepEqual(disabledKeys, applicationKeys);
    assert.match(block, /COALESCE\(account_user\."notificationPreferences", '\{\}'::jsonb\)\s*\|\|/);
    assert.match(block, /"updatedAt" = changed_at/);
    assert.match(block, /GET DIAGNOSTICS updated_rows = ROW_COUNT/);
  });

  it("routes signed unsubscribe through parameterized wrappers with no direct User calls", () => {
    const access = source("src/lib/userSignedUnsubscribeAccess.ts");
    const unsubscribe = source("src/lib/unsubscribe.ts");
    assert.match(access, /\$\{input\.suppressionKeys\}::text\[\]/);
    assert.match(access, /\$\{input\.issuedAt\}::timestamp/);
    assert.match(access, /\$\{suppressionKeys\}::text\[\]/);
    assert.match(access, /rows\.length !== 1/);
    assert.match(access, /Number\.isSafeInteger\(outcome\.updatedCount\)/);
    assert.match(unsubscribe, /userSignedUnsubscribeTokenSuperseded\(prisma, \{/);
    assert.match(unsubscribe, /disableUserSignedUnsubscribeEmailPreferences\(\s*tx,\s*emails/);
    assert.doesNotMatch(unsubscribe, /(?:prisma|tx)\.user\./);
    assert.doesNotMatch(unsubscribe, /FROM "User"/);

    const report = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/audit-user-direct-calls.mjs", "--json"],
      { encoding: "utf8" },
    ));
    assert.deepEqual(report, { count: 0, files: 0, byMethod: {}, calls: [] });
  });

  it("isolates the additive migration before historical guards and restores it after its predecessor", () => {
    const workflow = source(".github/workflows/ci.yml");
    const verify = workflow.indexOf("name: Verify User signed-unsubscribe authority source package");
    const isolate = workflow.indexOf("name: Isolate User signed-unsubscribe authority until historical release guards pass");
    const historical = workflow.indexOf("name: Verify compatible Order checkout receipt authority release");
    const tests = workflow.indexOf("name: Tests");
    const ownerApply = workflow.indexOf("name: Apply User owner-private authority in disposable PostgreSQL");
    const restore = workflow.indexOf("name: Restore User signed-unsubscribe authority source package");
    const apply = workflow.indexOf("name: Apply User signed-unsubscribe authority in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User signed-unsubscribe authority catalog");
    const build = workflow.indexOf("name: Production build");
    assert.ok(verify >= 0 && verify < isolate);
    assert.ok(isolate < historical && historical < tests);
    assert.ok(tests < ownerApply && ownerApply < restore);
    assert.ok(restore < apply && apply < catalog && catalog < build);
    assert.match(
      workflow.slice(isolate, historical),
      /prisma\/migrations\/20261004020000_prepare_user_signed_unsubscribe_authorities/,
    );
    assert.match(
      workflow.slice(restore, build),
      /--file=prisma\/migrations\/20261004020000_prepare_user_signed_unsubscribe_authorities\/migration\.sql/,
    );
    assert.match(workflow.slice(catalog, build), /pg_catalog\.count\(\*\) = 2/);
    assert.match(workflow.slice(catalog, build), /grainline_user_unsubscribe_preferences_disable/);
    assert.match(workflow.slice(catalog, build), /Audit runtime grants after User signed-unsubscribe authority/);
  });
});
