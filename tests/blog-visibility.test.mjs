import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BlogPostStatus } from "@prisma/client";

const { publicBlogPostWhere } = await import("../src/lib/blogVisibility.ts");

describe("blog visibility", () => {
  it("composes public blog filters so callers cannot override author or seller safety", () => {
    const where = publicBlogPostWhere({ sellerProfileId: "seller_1" });
    assert.equal(where.AND[0].status, BlogPostStatus.PUBLISHED);
    assert.equal(where.AND[0].publishedAt.not, null);
    assert.ok(where.AND[0].publishedAt.lte instanceof Date);
    assert.deepEqual(where, {
      AND: [
        {
          status: BlogPostStatus.PUBLISHED,
          publishedAt: where.AND[0].publishedAt,
          author: { banned: false, deletedAt: null },
          OR: [
            { sellerProfileId: null },
            {
              sellerProfile: {
                chargesEnabled: true,
                OR: [
                  { stripeAccountVersion: null },
                  { stripeAccountVersion: "v2" },
                ],
                vacationMode: false,
                user: { banned: false, deletedAt: null },
              },
            },
          ],
        },
        { sellerProfileId: "seller_1" },
      ],
    });
  });
});
