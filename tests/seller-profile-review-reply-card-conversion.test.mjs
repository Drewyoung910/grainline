import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listingPage = readFileSync("src/app/listing/[id]/page.tsx", "utf8");
const reviewsSection = readFileSync("src/components/ReviewsSection.tsx", "utf8");

test("listing reviews reuse the authorized seller card instead of querying SellerProfile", () => {
  assert.match(
    listingPage,
    /<ReviewsSection[\s\S]*sellerName=\{sellerName\}[\s\S]*sellerAvatarUrl=\{sellerAvatar\}[\s\S]*viewerIsSeller=\{viewerIsSeller\}/u,
  );
  assert.match(reviewsSection, /sellerName: string;/u);
  assert.match(reviewsSection, /sellerAvatarUrl: string \| null;/u);
  assert.match(reviewsSection, /viewerIsSeller: boolean;/u);
  assert.doesNotMatch(reviewsSection, /prisma\.sellerProfile/u);
  assert.doesNotMatch(
    reviewsSection,
    /select:\s*\{\s*seller:\s*\{\s*select:\s*\{\s*userId:/u,
  );
});

test("the buyer's own review shows the maker reply with the shared reply card", () => {
  assert.match(reviewsSection, /function SellerReplyCard\(/u);
  assert.match(
    reviewsSection,
    /mine\.sellerReply[\s\S]*<SellerReplyCard[\s\S]*reply=\{mine\.sellerReply\}[\s\S]*repliedAt=\{mine\.sellerReplyAt\}/u,
  );
  assert.match(
    reviewsSection,
    /r\.sellerReply[\s\S]*<SellerReplyCard[\s\S]*reply=\{r\.sellerReply\}[\s\S]*repliedAt=\{r\.sellerReplyAt\}/u,
  );
});
