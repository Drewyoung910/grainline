import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  normalizeSearchQueryParameter,
  searchParamsContainNullByte,
} = await import("../src/lib/searchQueryState.ts");

describe("search query NUL-byte boundary", () => {
  it("detects encoded NUL bytes in query names and values before routing", () => {
    assert.equal(
      searchParamsContainNullByte(new URL("https://example.test/browse?q=%00").searchParams),
      true,
    );
    assert.equal(
      searchParamsContainNullByte(new URL("https://example.test/blog?%00tag=wood").searchParams),
      true,
    );
    assert.equal(
      searchParamsContainNullByte(new URL("https://example.test/browse?q=walnut").searchParams),
      false,
    );
  });

  it("keeps database-bound search text NUL-free and bounded by code points", () => {
    assert.equal(normalizeSearchQueryParameter("  wal\u0000nut  ", 200), "walnut");
    assert.equal(normalizeSearchQueryParameter("ＡＢ\u0000", 2), "AB");
    assert.equal(normalizeSearchQueryParameter("🪵🪚table", 2), "🪵🪚");
  });
});
