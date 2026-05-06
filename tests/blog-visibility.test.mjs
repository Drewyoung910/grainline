import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BlogPostStatus } from "@prisma/client";

const { publicBlogPostWhere } = await import("../src/lib/blogVisibility.ts");

describe("blog visibility", () => {
  it("composes public blog filters so callers cannot override author or seller safety", () => {
    assert.deepEqual(publicBlogPostWhere({ sellerProfileId: "seller_1" }), {
      AND: [
        {
          status: BlogPostStatus.PUBLISHED,
          author: { banned: false, deletedAt: null },
          OR: [
            { sellerProfileId: null },
            {
              sellerProfile: {
                chargesEnabled: true,
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
