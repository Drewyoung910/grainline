import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      const filePath = path.join(
        process.cwd(),
        "src",
        relative.endsWith(".ts") ? relative : `${relative}.ts`,
      );
      return nextResolve(pathToFileURL(filePath).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  deleteOwnerSavedSearch,
  inspectOwnerSavedSearchCanary,
  listOwnerSavedSearches,
} = await import("../src/lib/savedSearchOwnerAccess.ts");

function savedSearchRow(overrides = {}) {
  return {
    id: "search_a",
    userId: "user_a",
    query: "walnut desk",
    category: "FURNITURE",
    listingType: "MADE_TO_ORDER",
    shipsWithinDays: 30,
    minRating: 4,
    lat: 32.78,
    lng: -96.8,
    radiusMiles: 25,
    sort: "newest",
    minPrice: 10000,
    maxPrice: 50000,
    tags: ["walnut"],
    notifyEmail: true,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    ...overrides,
  };
}

function rawQueryClient(results) {
  const calls = [];
  return {
    calls,
    client: {
      async $queryRaw(strings, ...values) {
        calls.push({ sql: strings.join("?"), values });
        if (results.length === 0) throw new Error("Missing mock query result");
        return results.shift();
      },
    },
  };
}

describe("SavedSearch owner RPC access", () => {
  it("lists owner rows through the parameterized function with explicit casts", async () => {
    const row = savedSearchRow();
    const db = rawQueryClient([[row]]);

    const rows = await listOwnerSavedSearches("user_a", db.client, {
      take: 20,
      searchId: "search_a",
    });

    assert.deepEqual(rows, [row]);
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].sql, /FROM public\.grainline_saved_search_list\(/);
    assert.match(db.calls[0].sql, /\?::text[\s\S]*\?::integer[\s\S]*\?::text/);
    assert.deepEqual(db.calls[0].values, ["user_a", 20, "search_a"]);
  });

  it("passes SQL nulls when the optional list filters are omitted", async () => {
    const db = rawQueryClient([[]]);

    assert.deepEqual(await listOwnerSavedSearches("user_a", db.client), []);
    assert.deepEqual(db.calls[0].values, ["user_a", null, null]);
  });

  it("rejects invalid context ids before querying", async () => {
    const db = rawQueryClient([[]]);

    await assert.rejects(
      listOwnerSavedSearches(" user_a ", db.client),
      /bounded local user id/,
    );
    assert.equal(db.calls.length, 0);
  });

  it("fails closed on cross-owner or malformed rows", async () => {
    const crossOwner = rawQueryClient([[savedSearchRow({ userId: "user_b" })]]);
    await assert.rejects(
      listOwnerSavedSearches("user_a", crossOwner.client),
      /owner RPC row invariant/,
    );

    const malformed = rawQueryClient([[savedSearchRow({ createdAt: "2026-07-17" })]]);
    await assert.rejects(
      listOwnerSavedSearches("user_a", malformed.client),
      /owner RPC row invariant/,
    );

    const notAnArray = rawQueryClient([{}]);
    await assert.rejects(
      listOwnerSavedSearches("user_a", notAnArray.client),
      /owner RPC result invariant/,
    );
  });

  it("uses the filtered list RPC for the exact canary lookup", async () => {
    const row = savedSearchRow();
    const db = rawQueryClient([[row]]);

    assert.deepEqual(
      await inspectOwnerSavedSearchCanary("user_a", "search_a", db.client),
      { exactMatch: true, matchCount: 1 },
    );
    assert.deepEqual(db.calls[0].values, ["user_a", 2, "search_a"]);

    const missing = rawQueryClient([[]]);
    assert.deepEqual(
      await inspectOwnerSavedSearchCanary("user_a", "search_a", missing.client),
      { exactMatch: false, matchCount: 0 },
    );

    const wrongSearch = rawQueryClient([[savedSearchRow({ id: "search_b" })]]);
    await assert.rejects(
      inspectOwnerSavedSearchCanary("user_a", "search_a", wrongSearch.client),
      /owner RPC row invariant/,
    );
  });

  it("deletes one owner row through the parameterized function", async () => {
    const db = rawQueryClient([[{ deletedCount: 1 }]]);

    assert.deepEqual(
      await deleteOwnerSavedSearch("user_a", "search_a", db.client),
      { count: 1 },
    );
    assert.match(db.calls[0].sql, /public\.grainline_saved_search_delete_one\(/);
    assert.match(db.calls[0].sql, /\?::text[\s\S]*\?::text/);
    assert.doesNotMatch(db.calls[0].sql, /Unsafe|Prisma\.raw/);
    assert.deepEqual(db.calls[0].values, ["user_a", "search_a"]);
  });

  it("fails closed on malformed delete results", async () => {
    for (const result of [
      {},
      [],
      [{ deletedCount: 2 }],
      [{ deletedCount: "1" }],
      [{ count: 1 }],
    ]) {
      const db = rawQueryClient([result]);
      await assert.rejects(
        deleteOwnerSavedSearch("user_a", "search_a", db.client),
        /delete RPC invariant/,
      );
    }
  });
});
