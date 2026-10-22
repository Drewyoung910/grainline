import assert from "node:assert/strict";
import test from "node:test";

const { accountDeletionBlogPostMediaOwnerWhere } = await import(
  "../src/lib/accountDeletionMediaState.ts"
);

test("account deletion selects every blog post owned by a maker identity", () => {
  assert.deepEqual(
    accountDeletionBlogPostMediaOwnerWhere("user_123", "seller_123"),
    {
      OR: [
        { authorId: "user_123" },
        { sellerProfileId: "seller_123" },
      ],
    },
  );
});

test("account deletion does not add a seller predicate for a buyer", () => {
  assert.deepEqual(
    accountDeletionBlogPostMediaOwnerWhere("user_123", null),
    { OR: [{ authorId: "user_123" }] },
  );
});
