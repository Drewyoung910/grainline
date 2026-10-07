import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";

import { RUNTIME_PRIVATE_FUNCTIONS } from "../scripts/audit-runtime-db-grants.mjs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const functionNames = [
  "grainline_review_reviewer_public_state_bind",
  "grainline_commission_buyer_public_state_bind",
  "grainline_user_public_review_commission_state_sync",
  "grainline_seller_public_commission_state_sync",
];

describe("User public review and commission state source boundary", () => {
  it("stores only artifact-bound public identity and lifecycle snapshots", () => {
    const schema = read("prisma/schema.prisma");
    const review = schema.slice(schema.indexOf("model Review"), schema.indexOf("model Conversation"));
    const commission = schema.slice(schema.indexOf("model CommissionRequest"), schema.indexOf("model CommissionInterest"));

    assert.match(review, /reviewerAccountActive\s+Boolean\s+@default\(false\)/);
    assert.match(review, /reviewerName\s+String\?\s+@db\.VarChar\(100\)/);
    assert.match(review, /reviewerImageUrl\s+String\?\s+@db\.VarChar\(2048\)/);
    assert.match(commission, /buyerAccountActive\s+Boolean\s+@default\(false\)/);
    assert.match(commission, /buyerName\s+String\?\s+@db\.VarChar\(100\)/);
    assert.match(commission, /buyerImageUrl\s+String\?\s+@db\.VarChar\(2048\)/);
    assert.match(commission, /buyerSellerCity\s+String\?\s+@db\.VarChar\(100\)/);
    assert.match(commission, /buyerSellerState\s+String\?\s+@db\.VarChar\(50\)/);
  });

  it("uses fixed private triggers and rejects artifact actor rebinding", () => {
    const migration = read("prisma/migrations/20261007020000_prepare_user_public_review_commission_state/migration.sql");
    assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 4);
    assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 4);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 4);
    assert.equal((migration.match(/^CREATE TRIGGER /gm) ?? []).length, 7);
    assert.match(migration, /Review reviewer cannot be rebound/);
    assert.match(migration, /Commission buyer cannot be rebound/);
    assert.match(migration, /AFTER UPDATE OF banned, "deletedAt", name, "imageUrl"[\s\S]*ON public\."User"/);
    assert.match(migration, /AFTER INSERT OR DELETE OR UPDATE OF "userId", city, state[\s\S]*ON public\."SellerProfile"/);
    assert.doesNotMatch(migration, /GRANT\s+|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /UPDATE public\."User"|DELETE FROM public\."User"/);
  });

  it("keeps every trigger function private during grant convergence", () => {
    const provisioning = read("scripts/provision-runtime-db-role.sql");
    for (const functionName of functionNames) {
      assert.equal(RUNTIME_PRIVATE_FUNCTIONS.includes(functionName), true);
      assert.equal(
        (provisioning.match(new RegExp(`public\\."${functionName}"\\(\\)`, "gu")) ?? []).length,
        2,
      );
      assert.doesNotMatch(
        provisioning,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\."${functionName}"\\(\\)`, "u"),
      );
    }
  });

  it("keeps public review reads off nested User relations", () => {
    for (const path of [
      "src/app/listing/[id]/page.tsx",
      "src/components/ReviewsSection.tsx",
      "src/app/seller/[id]/page.tsx",
      "src/app/seller/[id]/customer-photos/page.tsx",
    ]) {
      const source = read(path);
      assert.doesNotMatch(source, /reviewer:\s*\{\s*(?:select|where|banned):/);
      assert.match(source, /reviewerAccountActive/);
    }
  });

  it("filters every public commission query on snapshots without User joins", () => {
    const paths = [
      "src/lib/commissionState.ts",
      "src/app/commission/page.tsx",
      "src/app/commission/[param]/page.tsx",
      "src/app/api/commission/route.ts",
      "src/app/api/commission/[id]/route.ts",
      "src/app/api/commission/[id]/interest/route.ts",
    ];
    for (const path of paths) {
      const source = read(path);
      assert.doesNotMatch(source, /buyer:\s*\{\s*(?:select|where|banned):/);
      assert.doesNotMatch(source, /JOIN\s+"User"/);
    }
    const shared = read("src/lib/commissionState.ts");
    assert.match(shared, /buyerAccountActive: true/);
    const distance = read("src/app/commission/page.tsx");
    assert.match(distance, /cr\."buyerAccountActive" = true/);
    assert.ok(distance.indexOf('cr."buyerAccountActive" = true') < distance.indexOf("LIMIT $6 OFFSET $7"));
    const interest = read("src/app/api/commission/[id]/interest/route.ts");
    assert.match(interest, /if \(!commissionRequest\.buyerAccountActive\)/);
    for (const path of [
      "src/app/api/commission/route.ts",
      "src/app/api/commission/[id]/route.ts",
    ]) {
      const source = read(path);
      assert.match(source, /buyer: \{ name: buyerName, imageUrl: buyerImageUrl \}/);
    }
  });

  it("stages the package after the public blog snapshot in CI", () => {
    const workflow = read(".github/workflows/ci.yml");
    assert.doesNotThrow(() => yaml.load(workflow, { schema: yaml.JSON_SCHEMA }));
    const verify = workflow.indexOf("name: Verify User public review-commission source package");
    const isolate = workflow.indexOf("name: Isolate User public review-commission package until its predecessor passes");
    const blogApply = workflow.indexOf("name: Apply User public blog-state snapshot in disposable PostgreSQL");
    const restore = workflow.indexOf("name: Restore User public review-commission source package");
    const apply = workflow.indexOf("name: Apply User public review-commission snapshot in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User public review-commission snapshot catalog");
    const audit = workflow.indexOf("name: Audit runtime grants after User public review-commission snapshot");
    const build = workflow.indexOf("name: Production build");
    for (const position of [verify, isolate, blogApply, restore, apply, catalog, audit, build]) {
      assert.notEqual(position, -1);
    }
    assert.ok(verify < isolate);
    assert.ok(isolate < blogApply);
    assert.ok(blogApply < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < audit);
    assert.ok(audit < build);
  });
});
