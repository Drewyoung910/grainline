import assert from "node:assert/strict";
import test from "node:test";

import {
  firstSearchParams,
  parseBoundedDecimalParam,
  parseBoundedPositiveIntParam,
  parseTimestampMsParam,
} from "../src/lib/queryParams.ts";
import { normalizeSearchQueryParameter } from "../src/lib/searchQueryState.ts";

// Next passes string[] when a query key repeats, as in /browse?page=1&page=2.
test("query parameter parsers use the first repeated value instead of throwing", () => {
  assert.equal(parseBoundedPositiveIntParam(["2", "3"], 1, 500), 2);
  assert.equal(parseBoundedPositiveIntParam([], 1, 500), 1);
  assert.equal(parseBoundedDecimalParam(["4.5", "1"], 1, 5), 4.5);
  assert.equal(parseTimestampMsParam(["1000", "2000"]), 1000);
  assert.equal(normalizeSearchQueryParameter(["a", "b"], 200), "a");
  assert.equal(normalizeSearchQueryParameter([], 200), "");
});

test("firstSearchParams reduces every repeated key to one string", () => {
  assert.deepEqual(
    firstSearchParams({ q: ["a", "b"], category: "ART", page: undefined, tags: [] }),
    { q: "a", category: "ART", page: undefined, tags: undefined },
  );
});
