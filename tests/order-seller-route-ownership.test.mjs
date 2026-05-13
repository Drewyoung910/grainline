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

  it("keeps seller order read surfaces on whole-order ownership", () => {
    for (const path of [
      "src/app/api/seller/analytics/recent-sales/route.ts",
      "src/app/dashboard/sales/page.tsx",
      "src/app/api/account/export/route.ts",
      "src/app/account/page.tsx",
      "src/app/seller/[id]/page.tsx",
      "src/lib/accountDeletion.ts",
      "src/lib/ban.ts",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /some:\s*{\s*listing:\s*{\s*sellerId:/,
        `${path} must require at least one seller-owned item`,
      );
      assert.match(
        text,
        /every:\s*{\s*listing:\s*{\s*sellerId:/,
        `${path} must require every order item to belong to the seller before exposing seller-order data`,
      );
    }
  });
});
