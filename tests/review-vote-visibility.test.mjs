import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/api/reviews/[id]/vote/route.ts", "utf8");

describe("review vote visibility guardrails", () => {
  it("requires listing visibility before accepting helpful votes", () => {
    assert.match(
      source,
      /import \{ canViewListingDetail \} from "@\/lib\/listingVisibility";/,
      "review helpful votes must use the shared listing visibility helper",
    );
    assert.match(source, /status: true/);
    assert.match(source, /isPrivate: true/);
    assert.match(source, /reservedForUserId: true/);
    assert.match(source, /chargesEnabled: true/);
    assert.match(source, /stripeAccountVersion: true/);
    assert.match(source, /vacationMode: true/);
    assert.match(source, /banned: true/);
    assert.match(source, /deletedAt: true/);
    assert.match(
      source,
      /canViewListingDetail\(review\.listing, \{ dbUserId: me\.id \}\)/,
      "hidden, private, banned-seller, or disabled-seller listings must not be votable by id",
    );
  });

  it("uses deleteMany for concurrent unvote races", () => {
    assert.match(source, /reviewVote\.deleteMany\(\{\s*where: \{ reviewId: id, userId: me\.id \}/s);
    assert.match(source, /if \(deleted\.count === 1\)/);
    assert.doesNotMatch(source, /reviewVote\.delete\(\{/);
  });
});
