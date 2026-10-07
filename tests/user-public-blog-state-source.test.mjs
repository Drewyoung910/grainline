import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";

import { RUNTIME_PRIVATE_FUNCTIONS } from "../scripts/audit-runtime-db-grants.mjs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("User public blog-state source boundary", () => {
  it("stores only blog-bound lifecycle and public identity snapshots", () => {
    const schema = read("prisma/schema.prisma");
    const post = schema.slice(schema.indexOf("model BlogPost"), schema.indexOf("model BlogComment"));
    const comment = schema.slice(schema.indexOf("model BlogComment"), schema.indexOf("model SavedBlogPost"));

    for (const model of [post, comment]) {
      assert.match(model, /authorAccountActive\s+Boolean\s+@default\(false\)/);
      assert.match(model, /authorName\s+String\?\s+@db\.VarChar\(100\)/);
      assert.match(model, /authorImageUrl\s+String\?\s+@db\.VarChar\(2048\)/);
      assert.match(model, /authorSellerAvatarUrl\s+String\?\s+@db\.VarChar\(2048\)/);
    }
    assert.match(post, /authorSellerName\s+String\?\s+@db\.VarChar\(100\)/);
    assert.match(comment, /authorSellerProfilePresent\s+Boolean\s+@default\(false\)/);
  });

  it("maintains snapshots with fixed definer triggers and does not change User authority", () => {
    const migration = read(
      "prisma/migrations/20261007010000_prepare_user_public_blog_state/migration.sql",
    );

    assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 4);
    assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 4);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 4);
    assert.match(migration, /BEFORE INSERT OR UPDATE OF "authorId"[\s\S]*ON public\."BlogPost"/);
    assert.match(migration, /BEFORE INSERT OR UPDATE OF "authorId"[\s\S]*ON public\."BlogComment"/);
    assert.equal((migration.match(/EXECUTE FUNCTION public\.grainline_blog_post_author_public_state_bind\('/g) ?? []).length, 3);
    assert.equal((migration.match(/EXECUTE FUNCTION public\.grainline_blog_comment_author_public_state_bind\('/g) ?? []).length, 3);
    assert.match(migration, /grainline_blog_post_author_public_state_bind\('user'\)/);
    assert.match(migration, /grainline_blog_post_author_public_state_bind\('seller'\)/);
    assert.match(migration, /grainline_blog_comment_author_public_state_bind\('user'\)/);
    assert.match(migration, /grainline_blog_comment_author_public_state_bind\('seller'\)/);
    assert.match(migration, /AFTER UPDATE OF banned, "deletedAt", name, "imageUrl"[\s\S]*ON public\."User"/);
    assert.match(migration, /AFTER INSERT OR DELETE OR UPDATE OF "userId", "displayName", "avatarImageUrl"[\s\S]*ON public\."SellerProfile"/);
    assert.doesNotMatch(migration, /GRANT\s+|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /UPDATE public\."User"|DELETE FROM public\."User"/);
    assert.match(migration, /IF TG_ARGV\[0\] IN \('all', 'user'\)[\s\S]*SELECT account_user/);
    assert.match(migration, /IF TG_ARGV\[0\] IN \('all', 'seller'\)[\s\S]*SELECT seller/);
    assert.match(migration, /Blog post author cannot be rebound/);
    assert.match(migration, /Blog comment author cannot be rebound/);
  });

  it("keeps all four trigger functions private during grant convergence", () => {
    const provisioning = read("scripts/provision-runtime-db-role.sql");
    for (const functionName of [
      "grainline_blog_post_author_public_state_bind",
      "grainline_blog_comment_author_public_state_bind",
      "grainline_user_public_blog_state_sync",
      "grainline_seller_public_blog_state_sync",
    ]) {
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

  it("filters blog rows on snapshots before every raw-query limit", () => {
    const rawBlogFiles = [
      "src/app/blog/page.tsx",
      "src/app/api/blog/search/route.ts",
      "src/app/api/blog/search/suggestions/route.ts",
      "src/app/api/search/suggestions/route.ts",
      "src/lib/popularBlogTags.ts",
    ];

    for (const path of rawBlogFiles) {
      const source = read(path);
      const active = source.indexOf('"authorAccountActive" = true');
      const limit = source.indexOf("LIMIT", active);
      assert.notEqual(active, -1, `${path} must filter inactive blog authors`);
      assert.doesNotMatch(source, /JOIN "User" [a-z_]+ ON [a-z_]+\.id = (?:bp|"BlogPost")\."authorId"/);
      if (limit !== -1) assert.ok(active < limit, `${path} must filter lifecycle before limiting rows`);
    }
  });

  it("keeps public post and comment reads off nested User relations", () => {
    const publicFiles = [
      "src/app/page.tsx",
      "src/app/blog/page.tsx",
      "src/app/blog/[slug]/page.tsx",
      "src/app/account/saved/page.tsx",
      "src/app/api/blog/route.ts",
      "src/app/api/blog/search/route.ts",
      "src/app/api/blog/[slug]/comments/route.ts",
      "src/lib/savedBlogPostOwnerAccess.ts",
    ];

    for (const path of publicFiles) {
      const source = read(path);
      assert.doesNotMatch(source, /author:\s*\{\s*(?:select|where):/);
    }

    const visibility = read("src/lib/blogVisibility.ts");
    assert.match(visibility, /authorAccountActive: true/);
    assert.doesNotMatch(visibility, /author:\s*\{\s*banned:/);

    const comments = read("src/app/api/blog/[slug]/comments/route.ts");
    assert.match(comments, /authorAccountActive: true/);
    assert.match(comments, /author: authorFromSnapshot\(c\)/);
    assert.match(comments, /sellerProfile: row\.authorSellerProfilePresent/);
    assert.match(comments, /parent\.authorAccountActive !== true/);
    assert.match(comments, /grandparent\.authorAccountActive !== true/);
  });

  it("aligns public blog counts with the visible comment tree", () => {
    const blogApi = read("src/app/api/blog/route.ts");
    assert.match(blogApi, /comments:\s*\{\s*where:\s*\{\s*approved: true,\s*authorAccountActive: true,/s);
    assert.match(blogApi, /authorId: \{ notIn: blockedUserIdList \}/);
  });

  it("stages the migration after the accepted seller snapshot in CI", () => {
    const workflow = read(".github/workflows/ci.yml");
    assert.doesNotThrow(() => yaml.load(workflow, { schema: yaml.JSON_SCHEMA }));
    const verify = workflow.indexOf("name: Verify User public blog-state source package");
    const isolate = workflow.indexOf("name: Isolate User public blog-state package until its predecessor passes");
    const sellerApply = workflow.indexOf("name: Apply User public seller-state snapshot in disposable PostgreSQL");
    const restore = workflow.indexOf("name: Restore User public blog-state source package");
    const apply = workflow.indexOf("name: Apply User public blog-state snapshot in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User public blog-state snapshot catalog");
    const audit = workflow.indexOf("name: Audit runtime grants after User public blog-state snapshot");
    const build = workflow.indexOf("name: Production build");

    for (const position of [verify, isolate, sellerApply, restore, apply, catalog, audit, build]) {
      assert.notEqual(position, -1);
    }
    assert.ok(verify < isolate);
    assert.ok(isolate < sellerApply);
    assert.ok(sellerApply < restore);
    assert.ok(restore < apply);
    assert.ok(apply < catalog);
    assert.ok(catalog < audit);
    assert.ok(audit < build);
    assert.match(workflow, /pg_catalog\.count\(\*\) = 8[\s\S]*grainline_blog_post_author_user_state_bind[\s\S]*grainline_blog_comment_author_seller_state_bind/);
  });
});
