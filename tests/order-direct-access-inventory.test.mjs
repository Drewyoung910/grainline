import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SOURCE_ROOT = "src";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const EXPECTED_DIRECT_ORDER_FILES = Object.freeze([
  "src/app/admin/cases/[id]/page.tsx",
  "src/app/admin/flagged/page.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/admin/orders/page.tsx",
  "src/app/api/stripe/webhook/route.ts",
  "src/lib/accountDeletion.ts",
]);

const EXPECTED_DIRECT_ORDER_ITEM_FILES = Object.freeze([
  "src/app/api/stripe/webhook/route.ts",
  "src/components/ReviewsSection.tsx",
  "src/lib/accountDeletion.ts",
]);

const EXPECTED_DIRECT_QUOTE_FILES = Object.freeze([
  "src/lib/accountDeletion.ts",
]);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [target] : [];
  });
}

function directRelationFiles(delegate, relation) {
  const delegateAccess = new RegExp(
    `\\.${delegate}\\.(?:findUnique|findFirst|findMany|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)\\s*\\(`,
    "u",
  );
  const rawRelationAccess = new RegExp(
    `(?:FROM|JOIN|UPDATE|INTO)\\s+(?:public\\.)?"${relation}"(?:\\s|$)`,
    "u",
  );
  return sourceFiles(SOURCE_ROOT)
    .filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return delegateAccess.test(source) || rawRelationAccess.test(source);
    })
    .sort();
}

describe("Order-family direct access inventory", () => {
  it("pins every remaining direct Order consumer before Phase A", () => {
    assert.deepEqual(
      directRelationFiles("order", "Order"),
      EXPECTED_DIRECT_ORDER_FILES,
    );
  });

  it("pins the distinct successor inventories without bundling activation", () => {
    assert.deepEqual(
      directRelationFiles("orderItem", "OrderItem"),
      EXPECTED_DIRECT_ORDER_ITEM_FILES,
    );
    assert.deepEqual(
      directRelationFiles("orderShippingRateQuote", "OrderShippingRateQuote"),
      EXPECTED_DIRECT_QUOTE_FILES,
    );
  });
});
