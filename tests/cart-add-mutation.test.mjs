import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyCartAddMutation } from "../src/lib/cartAddMutation.ts";

function forbidden(name) {
  return async () => {
    throw new Error(`${name} must not run`);
  };
}

describe("cart add mutation", () => {
  it("creates a new line without running either update path", async () => {
    const result = await applyCartAddMutation({
      existingQuantity: null,
      madeToOrder: false,
      create: async () => ({ id: "new-line", quantity: 2 }),
      markMadeToOrder: forbidden("markMadeToOrder"),
      increment: forbidden("increment"),
      readUpdated: forbidden("readUpdated"),
    });

    assert.deepEqual(result, {
      ok: true,
      item: { id: "new-line", quantity: 2 },
    });
  });

  it("increments an existing line without attempting a duplicate insert", async () => {
    let incrementCalls = 0;
    const result = await applyCartAddMutation({
      existingQuantity: 2,
      madeToOrder: false,
      create: forbidden("create"),
      markMadeToOrder: forbidden("markMadeToOrder"),
      increment: async () => {
        incrementCalls += 1;
        return { count: 1 };
      },
      readUpdated: async () => ({ id: "existing-line", quantity: 5 }),
    });

    assert.equal(incrementCalls, 1);
    assert.deepEqual(result, {
      ok: true,
      item: { id: "existing-line", quantity: 5 },
    });
  });

  it("refreshes an existing made-to-order line without inserting or incrementing", async () => {
    let markCalls = 0;
    const result = await applyCartAddMutation({
      existingQuantity: 1,
      madeToOrder: true,
      create: forbidden("create"),
      markMadeToOrder: async () => {
        markCalls += 1;
      },
      increment: forbidden("increment"),
      readUpdated: async () => ({ id: "existing-line", quantity: 1 }),
    });

    assert.equal(markCalls, 1);
    assert.deepEqual(result, {
      ok: true,
      item: { id: "existing-line", quantity: 1 },
    });
  });

  it("returns the quantity-limit result when the guarded increment updates no row", async () => {
    const result = await applyCartAddMutation({
      existingQuantity: 99,
      madeToOrder: false,
      create: forbidden("create"),
      markMadeToOrder: forbidden("markMadeToOrder"),
      increment: async () => ({ count: 0 }),
      readUpdated: forbidden("readUpdated"),
    });

    assert.deepEqual(result, { ok: false, reason: "quantity_limit" });
  });
});
