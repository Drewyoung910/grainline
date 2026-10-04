import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("User public identity source boundary", () => {
  it("routes both public member counts through the fixed aggregate", () => {
    const aboutPage = read("src/app/about/page.tsx");
    const homepageStats = read("src/lib/homepageStats.ts");
    const access = read("src/lib/userPublicIdentityAccess.ts");

    for (const source of [aboutPage, homepageStats]) {
      assert.match(source, /getPublicActiveMemberCount\(\)/);
      assert.doesNotMatch(source, /prisma\.user\.count/);
    }
    assert.match(access, /SELECT public\.grainline_user_public_active_member_count\(\) AS value/);
  });

  it("keeps the aggregate additive and restricted to runtime execution", () => {
    const migration = read(
      "prisma/migrations/20261004040000_prepare_user_public_member_aggregate/migration.sql",
    );

    assert.match(migration, /SECURITY DEFINER/);
    assert.match(migration, /SET search_path = pg_catalog/);
    assert.match(migration, /source_user\.banned = false/);
    assert.match(migration, /source_user\."deletedAt" IS NULL/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_user_public_active_member_count\(\)\s+FROM PUBLIC/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_user_public_active_member_count\(\)\s+TO grainline_app_runtime/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|REVOKE [^\n]+ ON TABLE|UPDATE public\."User"|DELETE FROM public\."User"/);
  });

  it("isolates the additive migration until every accepted predecessor is restored", () => {
    const workflow = read(".github/workflows/ci.yml");
    const verify = workflow.indexOf("name: Verify User public-identity first source package");
    const isolate = workflow.indexOf("name: Isolate User public-identity first package until historical release guards pass");
    const historical = workflow.indexOf("name: Verify compatible Order checkout receipt authority release");
    const emailApply = workflow.indexOf("name: Apply User email-delivery authority in disposable PostgreSQL");
    const restore = workflow.indexOf("name: Restore User public-identity first source package");
    const apply = workflow.indexOf("name: Apply User public active-member aggregate in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User public active-member aggregate catalog");
    const grantAudit = workflow.indexOf("name: Audit runtime grants after User public active-member aggregate");
    const build = workflow.indexOf("name: Production build");

    for (const position of [verify, isolate, historical, emailApply, restore, apply, catalog, grantAudit, build]) {
      assert.notEqual(position, -1);
    }
    assert.ok(verify < isolate);
    assert.ok(isolate < historical);
    assert.ok(historical < emailApply);
    assert.ok(emailApply < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < grantAudit);
    assert.ok(grantAudit < build);
    assert.match(
      workflow.slice(isolate, historical),
      /20261004040000_prepare_user_public_member_aggregate/,
    );
  });
});
