import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { CATEGORY_LABELS, CATEGORY_VALUES } = await import("../src/lib/categories.ts");

describe("category labels", () => {
  it("keeps display labels aligned with the supported Category values", () => {
    assert.deepEqual(CATEGORY_VALUES, [
      "FURNITURE",
      "KITCHEN",
      "DECOR",
      "TOOLS",
      "TOYS",
      "JEWELRY",
      "ART",
      "OUTDOOR",
      "STORAGE",
      "OTHER",
    ]);
    assert.deepEqual(CATEGORY_VALUES, Object.keys(CATEGORY_LABELS));
  });

  it("uses a Prisma Category type-level guard for future enum drift", () => {
    const source = readFileSync("src/lib/categories.ts", "utf8");
    assert.match(source, /import type \{ Category \} from "@prisma\/client"/);
    assert.match(source, /satisfies Record<Category, string>/);
    assert.match(source, /CATEGORY_LABELS: Record<string, string>/);
    assert.match(source, /Object\.keys\(CATEGORY_LABELS\)/);
  });
});
