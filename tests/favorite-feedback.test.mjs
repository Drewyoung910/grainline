import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { favoriteErrorMessage } from "../src/lib/favoriteFeedback.ts";

const route = readFileSync("src/app/api/favorites/route.ts", "utf8");
const button = readFileSync("src/components/FavoriteButton.tsx", "utf8");

describe("favorite failure feedback", () => {
  it("keeps unavailable-listing and rate-limit guidance specific", () => {
    assert.equal(favoriteErrorMessage(403), "This listing isn’t available.");
    assert.equal(favoriteErrorMessage(404), "This listing isn’t available.");
    assert.equal(favoriteErrorMessage(429), "Too many save attempts. Try again shortly.");
  });

  it("does not expose unexpected server details to shoppers", () => {
    assert.equal(favoriteErrorMessage(400), "Couldn’t update saved items. Please try again.");
    assert.equal(favoriteErrorMessage(500), "Couldn’t update saved items. Please try again.");
    assert.equal(favoriteErrorMessage(503), "Couldn’t update saved items. Please try again.");
    assert.match(button, /toast\(favoriteErrorMessage\(res\.status\), "error"\)/u);
    assert.doesNotMatch(button, /toast\(data\?\.error/u);
  });

  it("distinguishes account lookup failures from signed-out requests", () => {
    assert.match(route, /source: "favorite_ensure_user"[\s\S]*HTTP_STATUS\.SERVICE_UNAVAILABLE/u);
    assert.doesNotMatch(route, /error: "DB error"/u);
    assert.match(route, /Couldn’t save this listing\. Please try again\./u);
  });
});
