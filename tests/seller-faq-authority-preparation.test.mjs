import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migrationDirectory =
  process.env.SELLER_FAQ_PREPARATION_MIGRATION_PATH
  ?? "prisma/migrations/20261030030000_prepare_seller_faq_authorities";
const migrationPath = `${migrationDirectory}/migration.sql`;
const migration = fs.readFileSync(migrationPath, "utf8");

function source(path) {
  return fs.readFileSync(path, "utf8");
}

function functionBody(name) {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} must be created`);
  const marker = `$${name}$;`;
  const end = migration.indexOf(marker, start);
  assert.ok(end > start, `${name} must have a complete definition`);
  return migration.slice(start, end + marker.length);
}

describe("SellerFaq compatible authority preparation", () => {
  it("keeps activation, grant revocation, schema and data changes out of preparation", () => {
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/u);
    assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/u);
    assert.doesNotMatch(migration, /REVOKE [^;]* ON TABLE public\."SellerFaq"/u);
    assert.doesNotMatch(migration, /(?:ALTER|DROP) TABLE public\."SellerFaq"/u);
    assert.match(migration, /SellerFaq RLS must remain off during compatible preparation/u);
    assert.match(migration, /SellerFaq compatible preparation changed RLS posture/u);
  });

  it("installs only purpose-bound fixed runtime operations", () => {
    for (const name of [
      "grainline_seller_faq_owner_create",
      "grainline_seller_faq_owner_remove",
      "grainline_seller_faq_owner_export",
      "grainline_seller_faq_account_deletion_cleanup",
    ]) {
      const body = functionBody(name);
      assert.match(body, /SECURITY DEFINER/u, name);
      assert.match(body, /SET search_path = pg_catalog/u, name);
      assert.match(body, /current_setting\('app\.user_id', true\)/u, name);
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*\\)\\s+FROM PUBLIC, grainline_app_runtime`, "u"),
        name,
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*\\)\\s+TO grainline_app_runtime`, "u"),
        name,
      );
    }
  });

  it("serializes create through the actor and owned parent before count and insert", () => {
    const create = functionBody("grainline_seller_faq_owner_create");
    const userLock = create.indexOf('FROM public."User" AS actor');
    const sellerLock = create.indexOf('FROM public."SellerProfile" AS seller');
    const replay = create.indexOf('FROM public."SellerFaq" AS faq');
    const count = create.indexOf("SELECT pg_catalog.count(*)", replay);
    const insert = create.indexOf('INSERT INTO public."SellerFaq"');
    assert.ok(userLock >= 0 && userLock < sellerLock);
    assert.ok(sellerLock < replay && replay < count && count < insert);
    assert.match(create, /FOR UPDATE/u);
    assert.match(create, />= 20/u);
    assert.match(create, /pg_catalog\.char_length\(p_question\) NOT BETWEEN 1 AND 200/u);
    assert.match(create, /pg_catalog\.char_length\(p_answer\) NOT BETWEEN 1 AND 2000/u);
  });

  it("binds cleanup to the active LOCAL_ANONYMIZE claim", () => {
    const cleanup = functionBody("grainline_seller_faq_account_deletion_cleanup");
    assert.match(cleanup, /request_user_id IS DISTINCT FROM p_expected_user_id/u);
    assert.match(cleanup, /effect\.kind = 'LOCAL_ANONYMIZE'/u);
    assert.match(cleanup, /effect\.status = 'PROCESSING'/u);
    assert.match(cleanup, /effect\."claimGeneration" = p_claim_generation/u);
    assert.match(cleanup, /effect\."claimToken" = p_claim_token/u);
    assert.match(cleanup, /FOR UPDATE/u);
  });

  it("converts all four direct application callers", () => {
    const dashboard = source("src/app/dashboard/profile/page.tsx");
    const exportRoute = source("src/app/api/account/export/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const access = source("src/lib/sellerFaqAccess.ts");

    assert.doesNotMatch(dashboard, /(?:prisma|tx)\.sellerFaq\./u);
    assert.doesNotMatch(exportRoute, /(?:prisma|tx)\.sellerFaq\./u);
    assert.doesNotMatch(deletion, /(?:prisma|tx)\.sellerFaq\./u);
    assert.match(dashboard, /createOwnerSellerFaq\(me\.id, question, answer\)/u);
    assert.match(dashboard, /removeOwnerSellerFaq\(me\.id, faqId\)/u);
    assert.match(exportRoute, /ownerSellerFaqExportRows\(user\.id\)/u);
    assert.match(deletion, /cleanupSellerFaqsForAccountDeletion\(tx,/u);
    assert.match(access, /randomUUID\(\)/u);
    assert.match(access, /withSerializableDbUserContext\(userId,/u);
  });

  it("retains the existing public and owner profile projections", () => {
    assert.match(migration, /grainline_seller_public_profile\(text\)/u);
    assert.match(migration, /grainline_seller_owner_profile_editor_state\(text\)/u);
    assert.match(
      source("src/lib/sellerProfilePublicAccess.ts"),
      /grainline_seller_public_profile\(\$\{sellerProfileId\}\)/u,
    );
    assert.match(
      source("src/lib/sellerOwnerPrivateAccess.ts"),
      /grainline_seller_owner_profile_editor_state/u,
    );
  });
});
