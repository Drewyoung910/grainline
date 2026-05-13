import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("admin server action guardrails", () => {
  it("blocks suspended or deleted staff accounts inside admin server actions", () => {
    for (const path of [
      "src/app/admin/actions.ts",
      "src/app/admin/support/actions.ts",
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/admin/verification/page.tsx",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /banned:\s*true/,
        `${path} must select staff banned state inside admin server actions`,
      );
      assert.match(
        text,
        /deletedAt:\s*true/,
        `${path} must select staff deletion state inside admin server actions`,
      );
      assert.match(
        text,
        /banned\s*\|\|\s*[^;\n]*deletedAt/,
        `${path} must block suspended or deleted staff accounts inside admin server actions`,
      );
    }
  });
});
