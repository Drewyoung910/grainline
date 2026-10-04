import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20261004010000_prepare_user_owner_private_authorities/migration.sql",
);

function functionBlock(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
}

function arrayValues(block, marker) {
  const start = block.indexOf(marker);
  assert.ok(start >= 0, `${marker} must exist`);
  const arrayStart = block.indexOf("ARRAY[", start);
  const arrayEnd = block.indexOf("]::text[]", arrayStart);
  assert.ok(arrayStart >= 0 && arrayEnd > arrayStart, `${marker} must own a text array`);
  return [...block.slice(arrayStart, arrayEnd).matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

describe("User owner-private authorities", () => {
  it("defines three fixed runtime-only definer functions", () => {
    const names = [
      "grainline_user_owner_shipping_address_update",
      "grainline_user_owner_legal_acceptance",
      "grainline_user_owner_notification_preference_update",
    ];
    assert.equal((migration.match(/^SECURITY DEFINER$/gmu) ?? []).length, 3);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gmu) ?? []).length, 3);
    for (const name of names) {
      const block = functionBlock(name);
      assert.match(block, /LANGUAGE plpgsql/);
      assert.match(block, /VOLATILE/);
      assert.match(block, /PARALLEL UNSAFE/);
      assert.doesNotMatch(block, /\bEXECUTE\b/);
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\(`));
      assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\(`));
    }
    assert.equal((migration.match(/FROM PUBLIC, grainline_app_runtime/gu) ?? []).length, 3);
    assert.equal((migration.match(/TO grainline_app_runtime/gu) ?? []).length, 3);
  });

  it("limits shipping updates to the seven validated address fields on an active owner", () => {
    const block = functionBlock("grainline_user_owner_shipping_address_update");
    for (const column of [
      "shippingName", "shippingLine1", "shippingLine2", "shippingCity",
      "shippingState", "shippingPostalCode", "shippingPhone",
    ]) {
      assert.match(block, new RegExp(`"${column}" =`));
    }
    assert.match(block, /account_user\.id = p_user_id/);
    assert.match(block, /account_user\.banned = false/);
    assert.match(block, /account_user\."deletedAt" IS NULL/);
    assert.match(block, /p_state <> ALL/);
    assert.match(block, /p_postal_code !~ '\^\[0-9\]\{5\}/);
    assert.match(block, /RETURN updated_rows = 1/);
  });

  it("limits legal acceptance to the current version and returns only its three fields", () => {
    const block = functionBlock("grainline_user_owner_legal_acceptance");
    assert.match(block, /p_terms_version IS DISTINCT FROM '2026-06-14'/);
    assert.match(block, /"termsAcceptedAt" timestamp\(3\),\s*"termsVersion" text,\s*"ageAttestedAt" timestamp\(3\)/);
    assert.match(block, /WHEN account_user\."termsAcceptedAt" IS NOT NULL/);
    assert.match(block, /account_user\."termsVersion" = p_terms_version/);
    assert.doesNotMatch(block, /email|shipping|notificationPreferences|role/);
  });

  it("keeps the database preference allowlists exactly aligned with application keys", () => {
    const keySource = source("src/lib/notificationPreferenceKeys.ts");
    const inAppBlock = keySource.match(/VALID_IN_APP_PREFERENCE_KEYS = \[([\s\S]*?)\] as const/u)?.[1];
    const emailBlock = keySource.match(/VALID_EMAIL_PREFERENCE_KEYS = \[([\s\S]*?)\] as const/u)?.[1];
    assert.ok(inAppBlock && emailBlock);
    const applicationKeys = [...`${inAppBlock}${emailBlock}`.matchAll(/"([A-Z0-9_]+)"/gu)].map((match) => match[1]);
    const applicationEmailKeys = [...emailBlock.matchAll(/"([A-Z0-9_]+)"/gu)].map((match) => match[1]);
    const block = functionBlock("grainline_user_owner_notification_preference_update");
    assert.deepEqual(arrayValues(block, "email_preference :="), applicationEmailKeys);
    assert.deepEqual(arrayValues(block, "p_preference_key <> ALL"), applicationKeys);
    assert.match(block, /WHEN p_enabled AND email_preference THEN changed_at/);
    assert.match(block, /pg_catalog\.jsonb_set/);
    assert.match(block, /pg_catalog\.to_jsonb/);
  });

  it("routes owner-private changes through wrappers and removes four direct User calls", () => {
    const access = source("src/lib/userOwnerPrivateAccess.ts");
    const settings = source("src/app/account/settings/page.tsx");
    const shipping = source("src/app/api/account/shipping-address/route.ts");
    const terms = source("src/app/api/account/accept-terms/route.ts");
    const preferences = source("src/app/api/account/notifications/preferences/route.ts");

    assert.match(access, /export async function updateUserOwnerShippingAddress/);
    assert.match(access, /export async function acceptUserOwnerLegalTerms/);
    assert.match(access, /export async function updateUserOwnerNotificationPreference/);
    assert.match(settings, /prisma\.sellerProfile\.findUnique/);
    assert.match(settings, /normalizeNotificationPreferences\(me\.notificationPreferences\)/);
    assert.doesNotMatch(settings, /prisma\.user\./);
    assert.match(shipping, /name: user\.shippingName \?\? null/);
    assert.match(shipping, /updateUserOwnerShippingAddress\(prisma,/);
    assert.doesNotMatch(shipping, /prisma\.user\./);
    assert.match(terms, /acceptUserOwnerLegalTerms\(tx,/);
    assert.ok(
      terms.indexOf("await acceptUserOwnerLegalTerms(tx")
        < terms.indexOf("await logUserAuditActionOrThrow"),
    );
    assert.doesNotMatch(terms, /tx\.user\./);
    assert.match(preferences, /updateUserOwnerNotificationPreference\(tx,/);
    assert.match(preferences, /clearOneClickEmailSuppression\(me\.email, tx\)/);
    assert.doesNotMatch(preferences, /UPDATE "User"/);

    const report = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/audit-user-direct-calls.mjs", "--json"],
      { encoding: "utf8" },
    ));
    assert.equal(report.count, 50);
    assert.equal(report.files, 27);
    assert.deepEqual(report.byMethod, {
      count: 3,
      findFirst: 1,
      findMany: 5,
      findUnique: 35,
      update: 3,
      updateMany: 3,
    });
  });

  it("isolates the additive migration before historical guards and proves its catalog afterward", () => {
    const workflow = source(".github/workflows/ci.yml");
    const verify = workflow.indexOf("name: Verify User owner-private authority source package");
    const isolate = workflow.indexOf("name: Isolate User owner-private authority until historical release guards pass");
    const historical = workflow.indexOf("name: Verify compatible Order checkout receipt authority release");
    const tests = workflow.indexOf("name: Tests");
    const restore = workflow.indexOf("name: Restore User owner-private authority source package");
    const apply = workflow.indexOf("name: Apply User owner-private authority in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User owner-private authority catalog");
    const build = workflow.indexOf("name: Production build");

    assert.ok(verify >= 0);
    assert.ok(verify < isolate);
    assert.ok(isolate < historical);
    assert.ok(historical < tests);
    assert.ok(tests < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < build);
    assert.match(
      workflow.slice(isolate, historical),
      /prisma\/migrations\/20261004010000_prepare_user_owner_private_authorities/,
    );
    assert.match(
      workflow.slice(restore, build),
      /--file=prisma\/migrations\/20261004010000_prepare_user_owner_private_authorities\/migration\.sql/,
    );
    assert.match(workflow.slice(catalog, build), /pg_catalog\.count\(\*\) = 3/);
    assert.match(workflow.slice(catalog, build), /grainline_user_owner_shipping_address_update/);
    assert.match(workflow.slice(catalog, build), /Audit runtime grants after User owner-private authority/);
  });
});
