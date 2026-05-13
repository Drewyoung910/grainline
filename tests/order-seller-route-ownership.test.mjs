import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller order mutation ownership guardrails", () => {
  it("requires seller routes to own the entire order, not just one order item", () => {
    for (const path of [
      "src/app/api/orders/[id]/refund/route.ts",
      "src/app/api/orders/[id]/fulfillment/route.ts",
      "src/app/api/orders/[id]/label/route.ts",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /order\.items\.length > 0 && order\.items\.every\(\(it\) => it\.listing\.sellerId === seller\.id\)/,
        `${path} must require every order item to belong to the seller`,
      );
      assert.doesNotMatch(
        text,
        /order\.items\.some\(\(it\) => it\.listing\.sellerId === seller\.id\)/,
        `${path} must not authorize whole-order mutations from partial order ownership`,
      );
    }
  });
});
