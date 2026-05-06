import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  canAttachConversationContextListing,
  canStartConversationWith,
} = await import("../src/lib/conversationStartState.ts");

const activeListing = {
  id: "listing_1",
  status: "ACTIVE",
  isPrivate: false,
  reservedForUserId: null,
  seller: {
    chargesEnabled: true,
    vacationMode: false,
    user: { id: "seller_user", banned: false, deletedAt: null },
  },
};

describe("conversation start state", () => {
  it("blocks unavailable recipients, self-conversations, and blocked users", () => {
    assert.equal(canStartConversationWith("me", { id: "other", banned: false, deletedAt: null }, false), true);
    assert.equal(canStartConversationWith("me", { id: "me", banned: false, deletedAt: null }, false), false);
    assert.equal(canStartConversationWith("me", { id: "other", banned: true, deletedAt: null }, false), false);
    assert.equal(canStartConversationWith("me", { id: "other", banned: false, deletedAt: new Date() }, false), false);
    assert.equal(canStartConversationWith("me", { id: "other", banned: false, deletedAt: null }, true), false);
    assert.equal(canStartConversationWith("me", null, false), false);
  });

  it("allows active public listings from active sellers as message context", () => {
    assert.equal(canAttachConversationContextListing(activeListing, ["buyer_user", "other_user"]), true);
  });

  it("allows private listings only between the seller and reserved buyer", () => {
    const privateReservedListing = {
      ...activeListing,
      isPrivate: true,
      reservedForUserId: "buyer_user",
    };

    assert.equal(canAttachConversationContextListing(privateReservedListing, ["seller_user", "buyer_user"]), true);
    assert.equal(canAttachConversationContextListing(privateReservedListing, ["seller_user", "other_user"]), false);
    assert.equal(canAttachConversationContextListing(privateReservedListing, ["buyer_user", "other_user"]), false);
  });

  it("rejects inactive listings and inactive sellers", () => {
    assert.equal(canAttachConversationContextListing({ ...activeListing, status: "DRAFT" }, ["buyer_user"]), false);
    assert.equal(
      canAttachConversationContextListing(
        { ...activeListing, seller: { ...activeListing.seller, chargesEnabled: false } },
        ["buyer_user"],
      ),
      false,
    );
    assert.equal(
      canAttachConversationContextListing(
        { ...activeListing, seller: { ...activeListing.seller, user: { id: "seller_user", banned: true } } },
        ["buyer_user"],
      ),
      false,
    );
  });
});
