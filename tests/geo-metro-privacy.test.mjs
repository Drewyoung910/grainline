import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/lib/geo-metro.ts", "utf8");

describe("geo metro privacy guardrails", () => {
  it("does not log auto-created metro locality details", () => {
    assert.match(source, /console\.log\("\[geo-metro\] Auto-created metro"\)/);
    assert.doesNotMatch(source, /console\.log\(`\[geo-metro\] Auto-created metro:/);
    assert.doesNotMatch(source, /console\.log\([^)]*geo\.city/);
    assert.doesNotMatch(source, /console\.log\([^)]*geo\.state/);
    assert.doesNotMatch(source, /console\.log\([^)]*slug/);
  });
});
