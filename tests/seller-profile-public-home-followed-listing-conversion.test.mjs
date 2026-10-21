import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync("src/app/page.tsx", "utf8");

test("homepage followed-maker listings use the exact listing and seller authority", () => {
  assert.match(home, /sellerPublicFollowerListingTarget/u);
  assert.match(home, /sellerPublicFollowerListingTarget\(listing\.id, listing\.sellerId\)/u);

  const followedFeed = home.slice(
    home.indexOf("if (follows.length >= 3)"),
    home.indexOf("const merged: FromYourMakersItem[]"),
  );
  assert.doesNotMatch(followedFeed, /seller:\s*\{\s*select:/u);
  assert.match(followedFeed, /sellerDisplayName: target\.seller\.displayName/u);
});
