import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalSuggestions = readFileSync(
  "src/app/api/search/suggestions/route.ts",
  "utf8",
);
const blogSuggestions = readFileSync(
  "src/app/api/blog/search/suggestions/route.ts",
  "utf8",
);

test("public seller-name suggestion callers use the bounded authority", () => {
  assert.match(
    globalSuggestions,
    /sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, true, 2\)/u,
  );
  assert.match(
    blogSuggestions,
    /sellerPublicNameSuggestions\(meDbId, q, normalizedDisplayNameQuery, false, 3\)/u,
  );
  assert.doesNotMatch(globalSuggestions, /sellerProfile\.findMany/u);
  assert.doesNotMatch(blogSuggestions, /sellerProfile\.findMany/u);
});
