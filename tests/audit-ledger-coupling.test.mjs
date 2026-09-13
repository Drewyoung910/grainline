import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("audit ledger coupling guardrails", () => {
  it("keeps regression tests independent from raw audit imports", () => {
    const rawAuditPath = ["audit", "open", "findings"].join("_") + ".md";

    for (const file of readdirSync("tests")) {
      if (!file.endsWith(".test.mjs")) continue;
      const path = join("tests", file);
      assert.doesNotMatch(source(path), new RegExp(rawAuditPath.replace(".", "\\.")), path);
    }
  });
});
