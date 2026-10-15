import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { drainMutatingFilterBatches } from "../src/lib/drainMutatingFilterBatches.ts";

describe("mutating-filter batch drain", () => {
  it("processes every row when each mutation removes that row from the next query", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: String(index + 1).padStart(4, "0"),
      matches: true,
    }));
    const processed = [];
    let loadCount = 0;

    await drainMutatingFilterBatches({
      keyOf: (row) => row.id,
      loadBatch: async () => {
        loadCount += 1;
        return rows.filter((row) => row.matches).slice(0, 500);
      },
      mutate: async (row) => {
        assert.equal(row.matches, true);
        row.matches = false;
        processed.push(row.id);
      },
    });

    assert.equal(loadCount, 4);
    assert.equal(processed.length, 1001);
    assert.equal(new Set(processed).size, 1001);
    assert.deepEqual(rows.filter((row) => row.matches), []);
  });

  it("does not invoke the mutator when no rows match", async () => {
    let mutationCount = 0;

    await drainMutatingFilterBatches({
      keyOf: () => "unused",
      loadBatch: async () => [],
      mutate: async () => {
        mutationCount += 1;
      },
    });

    assert.equal(mutationCount, 0);
  });

  it("fails fast when a mutation leaves the same row in the query filter", async () => {
    const row = { id: "stuck" };
    let mutationCount = 0;

    await assert.rejects(
      drainMutatingFilterBatches({
        keyOf: (item) => item.id,
        loadBatch: async () => [row],
        mutate: async () => {
          mutationCount += 1;
        },
      }),
      /made no progress for row stuck/u,
    );
    assert.equal(mutationCount, 1);
  });
});
