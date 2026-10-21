import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/api/reviews/[id]/vote/route.ts", "utf8");

describe("review vote visibility guardrails", () => {
  it("requires the actor-bound review target before accepting helpful votes", () => {
    assert.match(
      source,
      /import \{ sellerPublicReviewVoteTarget \} from "@\/lib\/sellerProfilePublicAccess";/,
      "review helpful votes must use the bounded database visibility authority",
    );
    assert.match(
      source,
      /sellerPublicReviewVoteTarget\(me\.id, id\)/,
      "hidden, private, banned-seller, or disabled-seller listings must not be votable by id",
    );
    assert.doesNotMatch(source, /canViewListingDetail/);
    assert.doesNotMatch(source, /listing:\s*\{\s*select:/);
    assert.match(source, /if \(review\.reviewerId === me\.id\)/);
    assert.match(source, /if \(review\.sellerUserId === me\.id\)/);
  });

  it("uses deleteMany for concurrent unvote races", () => {
    assert.match(source, /reviewVote\.deleteMany\(\{\s*where: \{ reviewId: id, userId: me\.id \}/s);
    assert.match(source, /if \(deleted\.count === 1\)/);
    assert.doesNotMatch(source, /reviewVote\.delete\(\{/);
  });
});
