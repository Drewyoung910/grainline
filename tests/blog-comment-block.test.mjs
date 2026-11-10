import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function loadPost({ blocked = [], parent = null } = {}) {
  const created = [];
  const dependencies = {
    "next/server": {},
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/db": {
      prisma: {
        blogPost: {
          findFirst: async () => ({ id: "post", authorId: "maker", title: "Post" }),
        },
        blogComment: {
          findUnique: async () => parent,
          create: async ({ data }) => {
            created.push(data);
            return { id: "comment" };
          },
        },
      },
    },
    "@/lib/userIdentityAccess": {
      userClerkGate: async () => ({ id: "me", banned: false, deletedAt: null }),
      userIdByClerkId: async () => ({ id: "me" }),
    },
    "@/lib/sanitize": { sanitizeText: (text) => text },
    "@/lib/profanity": { containsProfanity: () => ({ flagged: false, matches: [] }) },
    "@/lib/profanityTelemetry": { captureProfanityFlag: () => {} },
    "@/lib/ratelimit": {
      blogCommentRatelimit: {},
      getIP: () => "1.1.1.1",
      rateLimitResponse: () => ({}),
      safeRateLimit: async () => ({ success: true }),
      searchRatelimit: {},
    },
    "@/lib/blogVisibility": { publicBlogPostWhere: (where) => where },
    "@/lib/blogCommentLimits": {},
    "@/lib/requestBody": {
      isInvalidJsonBodyError: () => false,
      isRequestBodyTooLargeError: () => false,
      readBoundedJson: async (req) => req.body,
    },
    "@/lib/httpStatus": {
      HTTP_STATUS: { CREATED: 201, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413 },
    },
    "@/lib/privateResponse": {
      privateJson: (body, init) => ({ body, status: init?.status ?? 200 }),
      privateResponse: (response) => response,
    },
    "@/lib/blocks": { getBlockedUserIdsFor: async () => new Set(blocked) },
    zod: { z },
  };
  const path = "src/app/api/blog/[slug]/comments/route.ts";
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInThisContext(`(function (exports, require) {${javascript}\n})`)(exports, (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  });
  return { POST: exports.POST, created };
}

const context = { params: Promise.resolve({ slug: "post" }) };

test("a user blocked either way with the post author cannot comment", async () => {
  const { POST, created } = loadPost({ blocked: ["maker"] });
  const response = await POST({ body: { body: "hello" } }, context);
  assert.equal(response.status, 404);
  assert.equal(created.length, 0);
});

test("a user cannot reply to a comment author they are blocked with", async () => {
  const { POST, created } = loadPost({
    blocked: ["other"],
    parent: { id: "parent", postId: "post", parentId: null, approved: true, authorAccountActive: true, authorId: "other" },
  });
  const response = await POST({ body: { body: "hello", parentId: "parent" } }, context);
  assert.equal(response.status, 400);
  assert.equal(created.length, 0);
});

test("an unblocked user can still comment", async () => {
  const { POST, created } = loadPost();
  const response = await POST({ body: { body: "hello" } }, context);
  assert.equal(response.status, 201);
  assert.equal(created.length, 1);
});
