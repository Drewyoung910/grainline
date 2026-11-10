import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const row = {
  id: "post",
  slug: "post",
  title: "Post",
  authorId: "internal-user-id",
  authorName: "Personal Name",
  authorImageUrl: "https://example.test/personal.jpg",
  authorSellerName: "Oak Shop",
  authorSellerAvatarUrl: "https://example.test/shop.jpg",
  sellerProfileId: "seller",
};

function loadRoute(path) {
  const dependencies = {
    "next/server": {
      NextResponse: { json: (body) => ({ body }) },
    },
    "@clerk/nextjs/server": { auth: async () => ({ userId: null }) },
    "@prisma/client": { BlogPostType: {}, Prisma: {} },
    "@/lib/db": {
      prisma: {
        blogPost: {
          count: async () => 1,
          findMany: async ({ select }) => [
            Object.fromEntries(Object.keys(select).filter((key) => key in row).map((key) => [key, row[key]])),
          ],
        },
      },
    },
    "@/lib/blogVisibility": {
      publicBlogPostWhere: (where) => where,
      publicBlogAuthorPresentation: (source, fallback) => ({
        name: source.authorSellerName ?? source.authorName ?? fallback,
        imageUrl: source.authorSellerAvatarUrl ?? source.authorImageUrl ?? null,
      }),
    },
    "@/lib/blocks": {
      getBlockedIdsFor: async () => ({ blockedUserIds: new Set(), blockedSellerIds: [] }),
    },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "me" }) },
    "@/lib/ratelimit": {
      getIP: () => "1.1.1.1",
      rateLimitResponse: () => ({}),
      safeRateLimit: async () => ({ success: true }),
      searchRatelimit: {},
    },
    "@/lib/sanitize": { truncateText: (value) => value },
    "@/lib/searchQueryState": {
      normalizeSearchQueryParameter: (value) => value?.trim() ?? "",
    },
    "@/lib/tags": { normalizeTags: () => [] },
    "@/lib/queryParams": { parseBoundedPositiveIntParam: () => 1 },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function (exports, require) {${javascript}\n})`)(exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return exports;
}

const request = {
  url: "https://thegrainline.com/api/blog",
  nextUrl: new URL("https://thegrainline.com/api/blog"),
};

for (const path of ["src/app/api/blog/route.ts", "src/app/api/blog/search/route.ts"]) {
  test(`${path} shows the shop name and no account name or user id`, async () => {
    const response = await loadRoute(path).GET(request);
    const body = JSON.stringify(response.body);
    assert.doesNotMatch(body, /Personal Name|personal\.jpg|internal-user-id/);
    assert.match(body, /Oak Shop/);
  });
}
