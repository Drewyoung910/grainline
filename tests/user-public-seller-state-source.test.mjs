import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("User public seller-state source boundary", () => {
  it("keeps only the bounded account-state and image fallback on SellerProfile", () => {
    const schema = read("prisma/schema.prisma");
    const sellerModel = schema.slice(
      schema.indexOf("model SellerProfile"),
      schema.indexOf("model SellerFaq"),
    );

    assert.match(sellerModel, /ownerAccountActive\s+Boolean\s+@default\(false\)/);
    assert.match(sellerModel, /ownerImageUrl\s+String\?\s+@db\.VarChar\(2048\)/);
    assert.doesNotMatch(sellerModel, /@@index\(\[ownerAccountActive\]\)/);
  });

  it("maintains the snapshot with restricted fixed trigger functions", () => {
    const migration = read(
      "prisma/migrations/20261004050000_prepare_user_public_seller_state/migration.sql",
    );

    assert.match(migration, /SECURITY DEFINER/g);
    assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 2);
    assert.match(migration, /FOR SHARE/);
    assert.match(migration, /BEFORE INSERT OR UPDATE OF[\s\S]*ON public\."SellerProfile"/);
    assert.match(migration, /AFTER UPDATE OF banned, "deletedAt", "imageUrl"[\s\S]*ON public\."User"/);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 2);
    assert.doesNotMatch(migration, /GRANT EXECUTE|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /UPDATE public\."User"|DELETE FROM public\."User"/);
    assert.doesNotMatch(migration, /SellerProfile_ownerAccountActive_idx/);
  });

  it("routes seller and listing visibility through the bounded snapshot", () => {
    const listing = read("src/lib/listingVisibility.ts");
    const seller = read("src/lib/sellerVisibility.ts");
    const saved = read("src/lib/savedListingVisibility.ts");
    const blog = read("src/lib/blogVisibility.ts");
    const commission = read("src/lib/commissionInterestCount.ts");

    for (const source of [listing, seller, saved, blog, commission]) {
      assert.match(source, /ownerAccountActive/);
      assert.doesNotMatch(source, /user:\s*\{\s*banned:\s*false,\s*deletedAt:\s*null/);
    }
    assert.match(listing, /listing\.seller\.userId === viewer\.dbUserId/);
    assert.doesNotMatch(listing, /clerkUserId/);
  });

  it("removes seller-account User joins before catalog ordering and limits", () => {
    const noUserJoinFiles = [
      "src/app/page.tsx",
      "src/app/browse/page.tsx",
      "src/app/api/listings/[id]/similar/route.ts",
      "src/app/api/listings/[id]/stock/route.ts",
      "src/lib/popularTags.ts",
      "src/lib/site-metrics-snapshot.ts",
    ];
    for (const path of noUserJoinFiles) {
      assert.doesNotMatch(read(path), /(?:FROM|JOIN)\s+"User"/);
    }

    const suggestions = read("src/app/api/search/suggestions/route.ts");
    assert.match(suggestions, /bp\."authorAccountActive" = true/);
    assert.doesNotMatch(suggestions, /JOIN "User" [a-z_]+ ON [a-z_]+\.id = bp\."authorId"/);
    assert.doesNotMatch(suggestions, /seller_user|u\.id = sp\."userId"/);

    for (const path of [
      "src/app/blog/page.tsx",
      "src/app/api/blog/search/route.ts",
      "src/app/api/blog/search/suggestions/route.ts",
      "src/lib/popularBlogTags.ts",
    ]) {
      const source = read(path);
      assert.match(source, /(?:bp|"BlogPost")\."authorAccountActive" = true/);
      assert.doesNotMatch(source, /JOIN "User" [a-z_]+ ON [a-z_]+\.id = (?:bp|"BlogPost")\."authorId"/);
      assert.match(source, /sp\."ownerAccountActive" = true/);
      assert.doesNotMatch(source, /seller_user/);
    }

    const commission = read("src/app/commission/page.tsx");
    assert.doesNotMatch(commission, /JOIN "User" u ON u\.id = cr\."buyerId"/);
    assert.match(commission, /cr\."buyerAccountActive" = true/);
    assert.match(commission, /cr\."buyerName", cr\."buyerImageUrl"/);
    assert.match(commission, /buyer: \{ name: r\.buyerName, imageUrl: r\.buyerImageUrl \}/);
    assert.match(commission, /isp\."ownerAccountActive" = true/);
    assert.doesNotMatch(commission, /JOIN "User" iu ON iu\.id = isp\."userId"/);

    const quality = read("src/lib/quality-score.ts");
    assert.match(quality, /userPublicListingFavoriteCounts\(prisma, listingIds\)/);
    assert.doesNotMatch(quality, /JOIN "User" fu ON fu\.id = f\."userId"/);
    assert.doesNotMatch(quality, /JOIN "User"[^\n]+sp\."userId"/);
  });

  it("keeps the additive migration behind its accepted predecessor in CI", () => {
    const workflow = read(".github/workflows/ci.yml");
    assert.doesNotThrow(() => yaml.load(workflow, { schema: yaml.JSON_SCHEMA }));
    const verify = workflow.indexOf("name: Verify User public seller-state source package");
    const isolate = workflow.indexOf("name: Isolate User public seller-state package until its predecessor passes");
    const aggregateApply = workflow.indexOf("name: Apply User public active-member aggregate in disposable PostgreSQL");
    const restore = workflow.indexOf("name: Restore User public seller-state source package");
    const apply = workflow.indexOf("name: Apply User public seller-state snapshot in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User public seller-state snapshot catalog");
    const build = workflow.indexOf("name: Production build");

    for (const position of [verify, isolate, aggregateApply, restore, apply, catalog, build]) {
      assert.notEqual(position, -1);
    }
    assert.ok(verify < isolate);
    assert.ok(isolate < aggregateApply);
    assert.ok(aggregateApply < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < build);
  });
});
